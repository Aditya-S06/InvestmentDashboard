"""Offline policy and actual HTTP transport tests; no credentials or live network."""
import concurrent.futures
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from desk_fixture_safety import ROOT
import os
import sys
def file_guard(event, args):
    if event == 'open' and isinstance(args[0], (str, bytes)):
        name = Path(os.fsdecode(args[0])).name
        if name == '.env' or name.startswith('.env.'):
            raise AssertionError('Dotenv access forbidden')
sys.addaudithook(file_guard)
from desk_policy import BUDGETS, TOOL_ROUNDS, config_policy
from desk_runtime import Runtime, DeskLimitError, transport
import httpx


class BudgetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import socket
        cls.network = patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden'))
        cls.network.start()

    @classmethod
    def tearDownClass(cls):
        cls.network.stop()

    def runtime(self, **kwargs):
        return Runtime('fast', time.time() + 300, **kwargs)

    def test_policy_and_checkpoint_identity(self):
        self.assertEqual(BUDGETS, {'fast': 300, 'standard': 600, 'deep': 900})
        self.assertEqual(TOOL_ROUNDS, {'fast': 3, 'standard': 5, 'deep': 8})
        import trading_desk_runner as runner
        from desk_checkpoint import effective_config, CONFIG_FIELDS, graph_settings
        with tempfile.TemporaryDirectory() as temp, patch.dict('os.environ', {
            'DESK_QUICK_MODEL': 'deepseek/deepseek-v4.1-flash',
            'DESK_DEEP_MODEL': 'anthropic/claude-haiku-5.5'}):
            root = Path(temp)
            config = runner.build_config('standard', True, root, root / 'memory.md', root / 'cache')
            saved = {k: config[k] for k in CONFIG_FIELDS}
            rebuilt = effective_config({'depth': 'standard'}, saved, config['backend_url'])
            for key in config_policy('standard'):
                self.assertEqual(config[key], rebuilt[key])
            saved.pop('desk_policy_version')
            with self.assertRaisesRegex(ValueError, 'older Desk'):
                graph_settings({'graphSettings': saved})

    def test_parallel_reservations_never_exceed_allowance(self):
        runtime = self.runtime()
        def admit(_):
            try:
                return runtime.admit({'messages': 'x' * 100_000}, 'quick')
            except DeskLimitError:
                return None
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            list(pool.map(admit, range(32)))
        self.assertLessEqual(runtime.reserved, .50)
        self.assertTrue(runtime.stopped)
        count = len(runtime.attempts)
        with self.assertRaises(DeskLimitError):
            runtime.admit({}, 'quick')  # upstream fallback cannot get new credit
        self.assertEqual(len(runtime.attempts), count)

    def test_real_transport_bounds_prices_tokens_retry_and_usage(self):
        seen = []
        def respond(request):
            seen.append((json.loads(request.content), request.extensions))
            if len(seen) == 1:
                return httpx.Response(429, json={'error': {'message': 'synthetic'}})
            return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': 'ok'}}],
                'usage': {'cost': .003, 'prompt_tokens': 100, 'completion_tokens': 20,
                          'completion_tokens_details': {'reasoning_tokens': 10}}})
        runtime = self.runtime()
        with httpx.Client(transport=transport(runtime, 'quick', httpx.MockTransport(respond))) as client, patch('desk_runtime.time.sleep'):
            result = client.post('https://example.invalid/chat/completions', json={'model': 'fixture', 'max_completion_tokens': 999999, 'messages': []})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(len(seen), 2)
        self.assertEqual(seen[0][0]['max_tokens'], 4096)
        self.assertNotIn('max_completion_tokens', seen[0][0])
        self.assertEqual(seen[0][0]['provider']['max_price']['completion'], 1.5)
        self.assertEqual(seen[0][1]['timeout']['read'], 45)
        self.assertEqual(runtime.spent, .003)
        self.assertGreater(runtime.reserved, 0)  # 429 billing unknown, not free
        self.assertEqual(runtime.attempts[-1]['reasoning_tokens'], 10)

    def test_truncation_stops_fallback_and_deadline_blocks_network(self):
        runtime = self.runtime()
        called = []
        def respond(request):
            called.append(True)
            return httpx.Response(200, json={'choices': [{'finish_reason': 'length'}], 'usage': {'cost': .001}})
        with httpx.Client(transport=transport(runtime, 'deep', httpx.MockTransport(respond))) as client:
            for _ in range(2):
                with self.assertRaises(DeskLimitError):
                    client.post('https://example.invalid/chat/completions', json={})
        self.assertEqual(len(called), 1)
        runtime = Runtime('fast', time.time() - 1)
        with self.assertRaises(DeskLimitError):
            runtime.admit({}, 'quick')

    def test_tool_reuse_and_explicit_evidence_limit(self):
        runtime = self.runtime()
        calls = []
        def tool(value):
            calls.append(value)
            return {'rows': [value]}
        first = runtime.tool('prices', tool, (1,), {})
        first['rows'].append(2)
        self.assertEqual(runtime.tool('prices', tool, (1,), {}), {'rows': [1]})
        self.assertEqual(calls, [1])
        self.assertTrue(runtime.tools[-1]['cached'])
        self.assertIn('DATA_UNAVAILABLE', runtime.tool('large', lambda: 'x' * 32_001, (), {}))

    def test_failed_state_keeps_curated_usage_without_payload(self):
        from desk_supervisor import attach_usage, curate_usage
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            runtime = self.runtime(path=root / 'usage-NVDA.json', settings={'quick_think_llm': 'fixture'})
            runtime.admit({'messages': 'NEVER_PERSIST_THIS'}, 'quick')
            state = {'revision': 0, 'results': [{'ticker': 'NVDA', 'status': 'failed', 'finalState': None}]}
            attach_usage(root, state)
            value = state['results'][0]['finalState']
            self.assertEqual(value['desk_usage']['attempts'][0]['status'], 'pending')
            self.assertNotIn('NEVER_PERSIST_THIS', (root / 'usage-NVDA.json').read_text())
            self.assertNotIn('headers', curate_usage({'headers': 'no'}))

    def test_actual_langchain_client_preserves_reasoning_blocks(self):
        import trading_desk_runner
        from desk_execution import install_clients
        from tradingagents.graph import trading_graph
        runtime = self.runtime()
        restore, clients = install_clients(runtime)
        try:
            with patch.dict('os.environ', {'OPENROUTER_API_KEY': 'offline-sentinel'}):
                client = trading_graph.create_tier_client({'llm_provider': 'openrouter',
                    'quick_think_llm': 'deepseek/deepseek-v4.1-flash', 'llm_max_retries': 0}, 'quick').get_llm()
            response = {'choices': [{'index': 0, 'finish_reason': 'tool_calls', 'message': {
                'role': 'assistant', 'content': '', 'reasoning_details': [{'type': 'reasoning.text', 'text': 'opaque'}],
                'tool_calls': [{'id': 'one', 'type': 'function', 'function': {'name': 'prices', 'arguments': '{}'}}]}}]}
            result = client._create_chat_result(response)
            outgoing = client._get_request_payload([result.generations[0].message])
            self.assertEqual(outgoing['messages'][0]['reasoning_details'][0]['text'], 'opaque')
            self.assertEqual(client.max_retries, 0)
        finally:
            restore()
            for client in clients:
                client.close()

    def test_memory_only_exposes_one_pending_entry_and_restores_context(self):
        import trading_desk_runner
        from desk_execution import memory_step
        from desk_runtime import MEMORY
        from types import SimpleNamespace
        entries = [{'ticker': 'NVDA', 'date': '2026-09-01'}, {'ticker': 'AAPL', 'date': '2026-09-02'}]
        seen = []
        log = SimpleNamespace(get_pending_entries=lambda: entries,
            get_past_context=lambda *a, **kw: 'known as of date')
        graph = SimpleNamespace(memory_log=log, config={}, reflector=None, _memory_as_of=lambda d: d)
        def settle(ticker, view, *args, **kwargs):
            seen.extend(view.get_pending_entries())
            self.assertTrue(MEMORY.get())
            self.assertFalse(kwargs['wait'])
            return SimpleNamespace(settled=[('NVDA', '2026-09-01')])
        with patch('tradingagents.memory.settlement.settle_pending', side_effect=settle):
            result = memory_step(graph, {'company_of_interest': 'AAPL', 'trade_date': '2026-10-01'}, self.runtime())
        self.assertEqual(len(seen), 1)
        self.assertEqual(result['past_context'], 'known as of date')
        self.assertIn('deferred', result['memory_note'])
        self.assertFalse(MEMORY.get())


if __name__ == '__main__':
    unittest.main()
