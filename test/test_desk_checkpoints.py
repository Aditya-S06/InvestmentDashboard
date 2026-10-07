"""Pinned upstream SQLite/graph tests, isolated artifacts and mocked node providers."""
from contextlib import ExitStack
from datetime import datetime, timezone
import json
import io
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from desk_checkpoint import (CONFIG_FIELDS, assert_idle, clear, graph_use, identity,
                             inspect_saved, inspection_workflow, listed, paths, remember, restore, upstream)
from desk_process import Lock, atomic_json
from desk_supervisor import empty
from subprocess_env import runtime_env

VALUE = dict(ticker='AAPL', asOf='2026-10-01', depth='fast', analysts=['market'], assetType='stock')
CONFIG = dict(deep_think_llm='fixture-deep', quick_think_llm='fixture-quick', output_language='French',
              benchmark_ticker='SPY', temperature=0.2, llm_max_retries=2, max_tokens=1000,
              api_key='NEVER_SAVE', backend_url='https://user:secret@invalid')


class CheckpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.network = patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden'))
        cls.network.start()
        upstream()

    @classmethod
    def tearDownClass(cls):
        cls.network.stop()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='desk10-')
        self.user = Path(self.temp.name) / 'user-one'
        self.user.mkdir()
        self.children = []

    def tearDown(self):
        for child in self.children:
            if child.poll() is None:
                child.kill()
            child.wait(timeout=5)
            for stream in (child.stdin, child.stdout, child.stderr):
                if stream:
                    stream.close()
        self.temp.cleanup()

    def checkpoint(self, value=None):
        value = value or VALUE
        from tradingagents.graph.checkpointer import get_checkpointer
        remember(self.user, value, CONFIG)
        workflow = inspection_workflow(value)
        config = {'configurable': {'thread_id': identity(value)}}
        with get_checkpointer(self.user / 'cache', value['ticker']) as saver:
            graph = workflow.compile(checkpointer=saver, interrupt_before=['Market Analyst'])
            graph.invoke({'company_of_interest': value['ticker'], 'trade_date': value['asOf'],
                          'asset_type': value['assetType'], 'messages': []}, config)
        return config

    def test_valid_interruption_and_real_upstream_resume_input(self):
        config = self.checkpoint()
        saved = listed(self.user, ['AAPL'])[0]['checkpoints'][0]
        self.assertEqual(saved['asOf'], VALUE['asOf'])
        self.assertEqual(restore(self.user, saved, VALUE), {k: CONFIG[k] for k in CONFIG_FIELDS})
        graph_type, _ = upstream()
        graph = graph_type.__new__(graph_type)
        graph.config = dict(data_cache_dir=str(self.user / 'cache'), checkpoint_enabled=True,
                            max_debate_rounds=1, max_risk_discuss_rounds=1)
        graph.selected_analysts = ('market',)
        workflow = inspection_workflow(VALUE)
        from langchain_core.runnables import RunnableLambda
        received = []
        def provider(state):
            received.append(state)
            raise RuntimeError('Mock provider reached resumed node')
        workflow.nodes['Market Analyst'].runnable = RunnableLambda(provider)
        graph.workflow = workflow
        graph._checkpointer_ctx = None
        with graph.checkpoint_scope('AAPL', VALUE['asOf'], 'stock') as tid:
            self.assertEqual(tid, config['configurable']['thread_id'])
            self.assertIsNone(graph.checkpoint_input({'messages': ['must not be injected']}))
            with self.assertRaisesRegex(RuntimeError, 'Mock provider'):
                graph.graph.invoke(graph.checkpoint_input({}), config)
        self.assertEqual(received[0]['company_of_interest'], 'AAPL')
        self.assertEqual(received[0]['messages'], [])
        self.assertNotIn('NEVER_SAVE', (self.user / 'cache/checkpoints/AAPL.settings.json').read_text())
        self.assertNotIn('backend_url', (self.user / 'cache/checkpoints/AAPL.settings.json').read_text())

    def test_completed_rows_removed_but_database_remains(self):
        self.checkpoint()
        from tradingagents.graph.checkpointer import clear_checkpoint
        graph_type, _ = upstream()
        from types import SimpleNamespace
        signature = graph_type._run_signature(SimpleNamespace(selected_analysts=('market',), config={
            'max_debate_rounds': 1, 'max_risk_discuss_rounds': 1}), 'stock')
        clear_checkpoint(self.user / 'cache', 'AAPL', VALUE['asOf'], signature)
        self.assertTrue((self.user / 'cache/checkpoints/AAPL.db').exists())
        self.assertEqual(listed(self.user, ['AAPL'])[0]['checkpoints'], [])

    def test_runner_restores_saved_models_and_tuning_with_fresh_environment_key(self):
        self.checkpoint()
        saved = listed(self.user, ['AAPL'])[0]['checkpoints'][0]
        directory, manifest = self.manifest()
        manifest['resume'] = {k: saved[k] for k in ('ticker', 'threadId', 'checkpointId')}
        atomic_json(directory / 'manifest.json', manifest)
        import trading_desk_runner as runner
        from types import SimpleNamespace
        captured = []
        def build(**kwargs):
            captured.append(kwargs)
            return SimpleNamespace(propagator=SimpleNamespace(get_graph_args=lambda **kw: {}),
                                   propagate=lambda *args: ({'company_of_interest': 'AAPL'}, 'Hold'))
        args = ['--ticker', 'AAPL', '--as-of', VALUE['asOf'], '--depth', 'fast', '--analysts', 'market',
                '--checkpoint', 'true', '--results-dir', str(directory), '--data-cache-dir', str(self.user / 'cache'),
                '--memory-log-path', str(self.user / 'trading_memory.md'), '--out', str(directory / 'out.json')]
        with ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, {'OPENROUTER_API_KEY': 'fresh-sentinel-key',
                                'DESK_DEEP_MODEL': 'new-default', 'DESK_QUICK_MODEL': 'new-default'}))
            stack.enter_context(patch.object(runner, 'TradingAgentsGraph', side_effect=build))
            stack.enter_context(patch.object(runner, '_EVENT_STREAM', io.StringIO()))
            stack.enter_context(patch.object(sys, 'stdout', io.StringIO()))
            stack.enter_context(patch.object(sys, 'stderr', io.StringIO()))
            self.assertEqual(runner._main(args), 0)
        self.assertEqual({k: captured[0]['config'][k] for k in CONFIG_FIELDS}, {k: CONFIG[k] for k in CONFIG_FIELDS})
        for file in self.user.rglob('*.json'):
            self.assertNotIn('fresh-sentinel-key', file.read_text())

    def test_terminal_rows_before_upstream_cleanup_are_not_resumable(self):
        config = self.checkpoint()
        from tradingagents.graph.checkpointer import get_checkpointer
        with get_checkpointer(self.user / 'cache', 'AAPL') as saver:
            graph = inspection_workflow(VALUE).compile(checkpointer=saver)
            graph.update_state(config, {'final_trade_decision': 'Hold'}, as_node='Portfolio Manager')
        self.assertIsNone(inspect_saved(self.user, VALUE))

    def test_wrong_date_asset_analysts_depth_and_stale_reference(self):
        self.checkpoint()
        saved = listed(self.user, ['AAPL'])[0]['checkpoints'][0]
        for change in ({'asOf': '2026-10-02'}, {'assetType': 'crypto'}, {'analysts': ['market', 'news']}, {'depth': 'deep'}):
            with self.subTest(change=change):
                wrong = {**VALUE, **change}
                self.assertNotEqual(identity(wrong), identity(VALUE))
                self.assertIsNone(inspect_saved(self.user, wrong))
                with self.assertRaisesRegex(ValueError, 'settings differ'):
                    restore(self.user, saved, wrong)
        with self.assertRaisesRegex(ValueError, 'changed'):
            restore(self.user, {**saved, 'checkpointId': 'stale'}, VALUE)

    def test_empty_corrupt_missing_settings_and_other_user(self):
        directory, db = paths(self.user, 'AAPL')
        remember(self.user, VALUE, CONFIG)
        sqlite3.connect(db).close()
        self.assertEqual(listed(self.user, ['AAPL'])[0]['checkpoints'], [])
        db.write_bytes(b'corrupt sqlite')
        self.assertIn('unreadable', listed(self.user, ['AAPL'])[0]['reason'])
        db.unlink()
        self.checkpoint()
        other = Path(self.temp.name) / 'user-two'
        self.assertEqual(listed(other, ['AAPL'])[0]['checkpoints'], [])
        self.assertFalse(clear(other, 'AAPL')['deleted'])
        self.assertTrue(db.exists())
        (directory / 'AAPL.settings.json').unlink()
        self.assertEqual(listed(self.user, ['AAPL'])[0]['checkpoints'], [])

    def manifest(self):
        directory = self.user / 'run-one'
        directory.mkdir()
        value = dict(version=1, jobId=uuid.uuid4().hex, id='run-one', userId=self.user.name,
                     tickers=['AAPL'], asOf=VALUE['asOf'], depth='fast', analysts=['market'],
                     assetType='stock', checkpoint=True, createdAt=datetime.now(timezone.utc).isoformat())
        atomic_json(directory / 'manifest.json', value)
        atomic_json(directory / 'state.json', empty(value))
        return directory, value

    def test_queued_running_and_terminal_but_live_owner_block_clear(self):
        self.checkpoint()
        directory, m = self.manifest()
        with self.assertRaises(ValueError):
            clear(self.user, 'AAPL')
        with Lock(directory / 'owner.lock'):
            for status in ('running', 'cancelled', 'failed', 'completed'):
                s = empty(m)
                s.update(status=status, activeTicker='AAPL', deadline=9999999999)
                atomic_json(directory / 'state.json', s)
                with self.assertRaises(ValueError):
                    clear(self.user, 'AAPL')
        self.assertTrue((self.user / 'cache/checkpoints/AAPL.db').exists())

    def test_use_lock_and_late_graph_rejection_and_scoped_sidecars(self):
        self.checkpoint()
        directory, db = paths(self.user, 'AAPL')
        with Lock(directory / 'AAPL.use.lock'):
            with self.assertRaises(TimeoutError):
                clear(self.user, 'AAPL')
        run, _ = self.manifest()
        with self.assertRaises(ValueError):
            with graph_use(self.user, 'AAPL', run):
                self.fail('ownerless graph must not write')
        # Make the queued manifest old enough to reconcile as interrupted.
        m = json.loads((run / 'manifest.json').read_text())
        m['createdAt'] = '2000-01-01T00:00:00Z'
        atomic_json(run / 'manifest.json', m)
        for suffix in ('-wal', '-shm', '-journal'):
            Path(str(db) + suffix).write_text('sidecar')
        self.assertTrue(clear(self.user, 'AAPL')['deleted'])
        self.assertTrue((directory / 'AAPL.use.lock').exists())
        self.assertFalse((directory / 'AAPL.settings.json').exists())
        self.assertFalse(db.exists())

    def helper(self):
        child = subprocess.Popen([sys.executable, str(ROOT / 'scripts/desk_checkpoint.py'), str(self.user)],
                                 env=runtime_env(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True)
        self.children.append(child)
        return child, json.loads(child.stdout.readline())

    def command(self, child, **request):
        child.stdin.write(json.dumps(request) + '\n'); child.stdin.flush()
        return json.loads(child.stdout.readline())

    def test_launch_clear_race_and_abandoned_launch_fence(self):
        child, ready = self.helper()
        self.assertTrue(ready['ready'])
        self.assertTrue(self.command(child, command='reserve', tickers=['AAPL'])['result']['reserved'])
        contender, response = self.helper()
        self.assertIn('busy', response['error'])
        contender.wait(timeout=5)
        child.stdin.close()  # parent died before acknowledging durable publication
        child.wait(timeout=5)
        with self.assertRaisesRegex(ValueError, 'queued launch'):
            clear(self.user, 'AAPL')
        self.assertFalse(clear(self.user, 'MSFT')['deleted'])

    def test_normal_release_allows_clear_and_paths_reject_escape_links(self):
        child, _ = self.helper()
        self.command(child, command='reserve', tickers=['AAPL'])
        self.command(child, command='release')
        child.wait(timeout=5)
        self.assertFalse(clear(self.user, 'AAPL')['deleted'])
        for ticker in ('../AAPL', 'CON', 'AAPL.', '../other'):
            with self.assertRaises(ValueError):
                paths(self.user, ticker)
        outside = Path(self.temp.name) / 'outside'
        outside.mkdir()
        link = self.user / 'linked'
        try:
            link.symlink_to(outside, target_is_directory=True)
        except OSError:
            return  # junction coverage is also exercised by tracked-source tests
        with self.assertRaises(ValueError):
            paths(link, 'AAPL')

    def test_published_launch_fence_recovers_via_durable_terminal_ownership(self):
        run_id = uuid.uuid4().hex
        child, _ = self.helper()
        self.command(child, command='reserve', tickers=['AAPL'], runId=run_id)
        directory, m = self.manifest()
        renamed = self.user / run_id
        directory.rename(renamed)
        m.update(id=run_id, createdAt='2000-01-01T00:00:00Z')
        atomic_json(renamed / 'manifest.json', m)
        atomic_json(renamed / 'state.json', empty(m))
        child.stdin.close()
        child.wait(timeout=5)
        # Reconciliation terminalizes the abandoned published launch, so a delayed
        # supervisor cannot start and no manual deletion of lock files is needed.
        self.assertFalse(clear(self.user, 'AAPL')['deleted'])


if __name__ == '__main__':
    unittest.main()
