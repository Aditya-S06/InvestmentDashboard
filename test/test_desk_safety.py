"""Offline regressions for the production Python tool/stream/memory boundaries."""
import asyncio
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from desk_fixture_safety import FRED_KEY, ROOT, UNICODE, fixture_env, guard, macro_probe, stream_probe


class SafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Windows asyncio builds a private loopback socketpair for wakeups.
        # Create that before the deny-all network guard; tool execution below
        # cannot open any new network connections, including localhost.
        cls.loop = asyncio.new_event_loop()
        guard()
        cls.environment = patch.dict(os.environ, fixture_env(), clear=True)
        cls.environment.start()
        import trading_desk_runner  # installs dotenv guard before pinned imports

    @classmethod
    def tearDownClass(cls):
        cls.loop.close()
        cls.environment.stop()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='desk14-')
        self.root = Path(self.temp.name)
        self.children = []

    def tearDown(self):
        for child in self.children:
            if child.poll() is None:
                child.kill()
            child.wait(timeout=10)
            for stream in (child.stdin, child.stdout, child.stderr):
                if stream:
                    stream.close()
        self.temp.cleanup()

    def assert_safe(self, value):
        self.assertNotIn(FRED_KEY, str(value))
        self.assertNotIn('desk14-router-sentinel', str(value))

    def test_real_macro_tool_graph_model_checkpoint_and_output(self):
        evidence = macro_probe(self.root)
        self.assertEqual(evidence['memoryType'], 'DeskMemoryLog')
        self.assertIn('DATA_UNAVAILABLE', evidence['direct'])
        self.assertIn('503', evidence['direct'])
        self.assertIn('[REDACTED]', evidence['direct'])
        self.assertEqual(len(evidence['prompts']), 2)
        message = next(m for m in evidence['prompts'][1] if m['type'] == 'tool')
        self.assertEqual(message['tool_call_id'], 'macro-call')
        self.assertEqual(message['name'], 'get_macro_indicators')
        self.assertIn('503', message['content'])
        self.assertIn('503', str(evidence['toolOutputs']))
        self.assertTrue(evidence['checkpoints'])
        self.assert_safe(evidence)
        for file in self.root.rglob('*'):
            if file.is_file():
                self.assertNotIn(FRED_KEY.encode(), file.read_bytes(), str(file))
        payload = json.loads((self.root / 'out-AAPL.json').read_text(encoding='utf-8'))
        self.assertIn(UNICODE, payload['finalState']['news_report'])
        self.assertIn('503', payload['finalState']['news_report'])

    def test_tool_contracts_artifacts_metadata_async_and_errors(self):
        from langchain_core.tools import StructuredTool, ToolException
        from langgraph.prebuilt import ToolNode
        from langgraph.graph import StateGraph, MessagesState, START, END
        from langchain_core.messages import AIMessage
        from desk_tool_safety import safe_tool
        from tradingagents.graph.checkpointer import get_checkpointer
        import trading_desk_runner as runner
        from tradingagents.agents.utils.macro_data_tools import get_macro_indicators
        graph = runner.TradingAgentsGraph.__new__(runner.TradingAgentsGraph)
        nodes = graph._create_tool_nodes()
        copied = nodes['news'].tools_by_name['get_macro_indicators']
        self.assertIsNot(copied, get_macro_indicators)
        self.assertIsNot(copied.func, get_macro_indicators.func)
        for key in ('name', 'description', 'args_schema', 'metadata', 'tags', 'response_format', 'return_direct'):
            self.assertEqual(getattr(copied, key), getattr(get_macro_indicators, key))
        for node in nodes.values():
            for tool in node.tools_by_name.values():
                self.assertTrue(hasattr(tool.func, '__wrapped__'))

        def payload(value: str):
            return ('result ' + value, {'price': 123.5, 'count': 4, 'available': True,
                                       'rows': [None, value], 'source': ('FRED', value)})
        async def apayload(value: str):
            return payload(value)
        raw = StructuredTool.from_function(payload, coroutine=apayload, name='values',
            description='Offline typed values', response_format='content_and_artifact',
            metadata={'provider': 'fixture'}, tags=['desk14'])
        tool = safe_tool(raw)
        self.assertEqual(tool.func(UNICODE), raw.func(UNICODE))
        call = {'name': 'values', 'args': {'value': FRED_KEY}, 'id': 'values-call', 'type': 'tool_call'}
        for message in (tool.invoke(call), self.loop.run_until_complete(tool.ainvoke(call))):
            self.assert_safe(message.model_dump())
            self.assertEqual(message.artifact['price'], 123.5)
            self.assertIs(message.artifact['available'], True)
            self.assertEqual(message.tool_call_id, 'values-call')
            self.assertEqual(message.artifact['source'], ('FRED', '[REDACTED]'))

        class QuietError(RuntimeError):
            def __str__(self):
                return 'HTTP 503 (details suppressed)'

        class HiddenRequestError(RuntimeError):
            def __init__(self, detail):
                super().__init__('HTTP 503')
                self.response = {'request': {'api_key': detail}}

        for index, kind in enumerate((RuntimeError, ValueError, ToolException, QuietError, HiddenRequestError)):
            def fail(value: str):
                raise kind('HTTP 503 ' + os.environ['FRED_API_KEY'])
            failing = safe_tool(StructuredTool.from_function(fail, description='Failure'))
            # Explicit error-message policy exercises ToolNode's conversion as
            # well as the default abort policy used for ordinary runtime errors.
            node = ToolNode([failing], handle_tool_errors=True)
            workflow = StateGraph(MessagesState)
            workflow.add_node('tools', node)
            workflow.add_edge(START, 'tools')
            workflow.add_edge('tools', END)
            initial = {'messages': [AIMessage(content='', tool_calls=[{
                'name': 'fail', 'args': {'value': 'fixture'}, 'id': 'failed-call'}])]}
            config = {'configurable': {'thread_id': 'errors'}}
            with get_checkpointer(self.root / 'errors', f'ERR{index}') as saver:
                result = workflow.compile(checkpointer=saver).invoke(initial, config)
                self.assert_safe(list(saver.list(None)))
            message = result['messages'][-1]
            self.assertEqual(message.status, 'error')
            self.assertIn('HTTP 503', message.content)
            self.assert_safe(message.model_dump())
            with self.assertRaises(Exception) as caught:
                failing.invoke({'value': 'fixture'})
            self.assert_safe(repr(caught.exception))
            self.assertIsNone(caught.exception.__context__)
            self.assertIsNone(caught.exception.__cause__)
            self.assertFalse(hasattr(caught.exception, 'response'))
            # Default ToolNode aborts on provider exceptions; its persisted
            # __error__ write must also be safe, not only handled ToolMessages.
            aborted = StateGraph(MessagesState)
            aborted.add_node('tools', ToolNode([failing]))
            aborted.add_edge(START, 'tools')
            aborted.add_edge('tools', END)
            with get_checkpointer(self.root / 'errors', f'ABORT{index}') as saver:
                with self.assertRaises(Exception) as caught:
                    aborted.compile(checkpointer=saver).invoke(initial, config)
                self.assert_safe(repr(caught.exception))
                checkpoints = list(saver.list(None))
                self.assertTrue(any(item.pending_writes for item in checkpoints))
                self.assert_safe(checkpoints)
        for file in (self.root / 'errors').rglob('*'):
            if file.is_file():
                self.assertNotIn(FRED_KEY.encode(), file.read_bytes(), str(file))

    def test_real_emitter_and_pump_override_cp1252(self):
        stream_probe(self.root)
        text = (self.root / 'events.jsonl').read_bytes().decode('utf-8', 'strict')
        events = [json.loads(line) for line in text.splitlines()]
        self.assertEqual([e['event'] for e in events], ['memo', 'error'])
        for event in events:
            self.assertIn(UNICODE, event.get('text', event.get('message')))
        self.assertNotIn('\ufffd', text)
        self.assert_safe(text)
        self.assert_safe((self.root / 'stderr.log').read_bytes().decode('utf-8', 'strict'))

    def worker(self, path, mode='memory', ticker='AAPL'):
        child = subprocess.Popen([sys.executable, str(ROOT / 'test/desk_fixture_safety.py'), mode, str(path), ticker],
                                 cwd=self.root, env=fixture_env(), stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
        self.children.append(child)
        child.replies = queue.Queue()
        def read():
            for line in child.stdout:
                child.replies.put(json.loads(line))
        threading.Thread(target=read, daemon=True).start()
        self.assertEqual(self.reply(child), {'ready': True})
        return child

    def send(self, child, **command):
        child.stdin.write(json.dumps(command) + '\n')
        child.stdin.flush()

    def reply(self, child):
        try:
            return child.replies.get(timeout=30)
        except queue.Empty:
            child.kill(); child.wait(timeout=10)
            self.fail('Memory fixture stalled: ' + child.stderr.read())

    def test_deterministic_append_update_and_update_update(self):
        from desk_memory import DeskMemoryLog
        path = self.root / 'user' / 'trading_memory.md'
        memory = DeskMemoryLog({'memory_log_path': str(path)})
        one, two = self.worker(path), self.worker(path)
        # All orderings pause the first mutation *after its real upstream read*.
        # The contender proves the same OS lock is held before trying its write.
        for first, second in (('update', 'append'), ('append', 'update'), ('update', 'batch'), ('batch', 'update')):
            with self.subTest(first=first, second=second):
                path.unlink(missing_ok=True)
                memory.store_decision('AAPL', '2026-10-01', 'Buy')
                if second != 'append':
                    memory.store_decision('MSFT', '2026-10-01', 'Hold')
                ticker = 'NVDA' if first == 'append' else 'AAPL'
                self.send(one, op=first, ticker=ticker, hold=True)
                self.assertEqual(self.reply(one), {'read': True})
                self.send(two, op=second, ticker='MSFT', probe=True)
                self.assertEqual(self.reply(two), {'blocked': True})
                self.send(one, release=True)
                self.assertEqual(self.reply(one), {'done': True})
                self.assertEqual(self.reply(two), {'done': True})
                entries = {e['ticker']: e for e in memory.load_entries()}
                self.assertEqual(set(entries), {'AAPL', 'MSFT'} | ({'NVDA'} if first == 'append' else set()))
                self.assertEqual(entries['AAPL']['pending'], first == 'append')
                self.assertEqual(entries['MSFT']['pending'], second == 'append')
                self.assertFalse(path.with_suffix('.tmp').exists())
        for child in (one, two):
            self.send(child, op='exit')
            self.assertEqual(child.wait(timeout=10), 0)

    def test_memory_exception_death_release_and_other_user_independence(self):
        from desk_memory import DeskMemoryLog
        path = self.root / 'user' / 'trading_memory.md'
        memory = DeskMemoryLog({'memory_log_path': str(path)})
        memory.store_decision('AAPL', '2026-10-01', 'Buy')
        one, two = self.worker(path), self.worker(path)
        other = self.worker(self.root / 'other-user' / 'trading_memory.md')
        self.send(one, op='error')
        self.assertEqual(self.reply(one), {'error': 'fixture failure'})
        self.send(two, op='append', ticker='MSFT', probe=True)
        self.assertEqual(self.reply(two), {'blocked': False})
        self.assertEqual(self.reply(two), {'done': True})
        self.send(one, op='update', hold=True)
        self.assertEqual(self.reply(one), {'read': True})
        self.send(other, op='append', ticker='NVDA', probe=True)
        self.assertEqual(self.reply(other), {'blocked': False})
        self.assertEqual(self.reply(other), {'done': True})
        self.send(two, op='batch', ticker='MSFT', probe=True)
        self.assertEqual(self.reply(two), {'blocked': True})
        one.kill(); one.wait(timeout=10)
        self.assertEqual(self.reply(two), {'done': True})
        entries = {e['ticker']: e for e in memory.load_entries()}
        self.assertTrue(entries['AAPL']['pending'])
        self.assertFalse(entries['MSFT']['pending'])
        self.assertTrue(path.with_name(path.name + '.lock').exists())
        for child in (two, other):
            self.send(child, op='exit')
            self.assertEqual(child.wait(timeout=10), 0)

    def test_different_ticker_graphs_overlap_outside_memory_operations(self):
        from desk_memory import DeskMemoryLog
        path = self.root / 'user' / 'trading_memory.md'
        one = self.worker(path, 'graph', 'AAPL')
        two = self.worker(path, 'graph', 'MSFT')
        for child in (one, two):
            self.send(child, op='run')
        # Both actual upstream _run_graph calls reach the provider boundary
        # while the other is held there; no whole-graph or provider-call lock.
        self.assertEqual(self.reply(one), {'provider': 'AAPL', 'memoryUnlocked': True})
        self.assertEqual(self.reply(two), {'provider': 'MSFT', 'memoryUnlocked': True})
        for child in (one, two):
            self.send(child, release=True)
        for child in (one, two):
            self.assertEqual(self.reply(child), {'done': True})
            self.assertEqual(child.wait(timeout=10), 0)
        memory = DeskMemoryLog({'memory_log_path': str(path)})
        self.assertEqual({e['ticker'] for e in memory.load_entries()}, {'AAPL', 'MSFT'})


if __name__ == '__main__':
    unittest.main()
