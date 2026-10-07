"""Actual offline subprocesses, isolated storage, sentinels; no DB or provider calls."""
import concurrent.futures
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from desk_process import Lock, atomic_json, graph_env
from desk_supervisor import control, empty
from subprocess_env import runtime_env


def until(predicate, timeout=12):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        result = predicate()
        if result:
            return result
        time.sleep(.04)
    raise AssertionError('fixture condition did not become true')


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='desk9-')
        self.directory = Path(self.temp.name) / 'user-one' / 'run-one'
        self.directory.mkdir(parents=True)
        self.children = []
        self.env = {**runtime_env(), 'OPENROUTER_API_KEY': 'sentinel-router', 'FRED_API_KEY': 'sentinel-fred',
                    'HTTPS_PROXY': 'http://proxy-user:proxy-password@proxy.invalid:123',
                    'DATABASE_URL': 'sentinel-db', 'NEXTAUTH_SECRET': 'sentinel-auth',
                    'WEBULL_APP_SECRET_PROD': 'sentinel-broker', 'FUTURE_SECRET': 'sentinel-future',
                    'OPENAI_API_KEY': 'sentinel-unrelated-provider'}

    def tearDown(self):
        try:
            if (self.directory / 'manifest.json').exists():
                control(self.directory, cancel=True)
            for child in self.children:
                if child.poll() is None:
                    child.wait(timeout=8)
        finally:
            for child in self.children:
                if child.poll() is None:
                    child.kill(); child.wait()
            self.temp.cleanup()

    def prepare(self, modes):
        m = dict(version=1, jobId=uuid.uuid4().hex, id='run-one', userId='user-one', tickers=list(modes),
                 asOf='2026-10-05', depth='fast', analysts=['market'], assetType='stock', checkpoint=True,
                 createdAt=datetime.now(timezone.utc).isoformat())
        atomic_json(self.directory / 'manifest.json', m)
        atomic_json(self.directory / 'state.json', empty(m))
        atomic_json(self.directory / 'fixture.json', modes)
        return m

    def launch(self, budget=5):
        child = subprocess.Popen([sys.executable, str(ROOT / 'test/desk_fixture_supervisor.py'), str(self.directory), str(budget)],
                                 env=graph_env(self.env), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        self.children.append(child)
        return child

    def state(self):
        return json.loads((self.directory / 'state.json').read_text())

    def finished(self):
        return until(lambda: (s if (s := control(self.directory))['status'] in ('completed', 'review', 'failed', 'cancelled') else None))

    def test_node_parent_restart_preserves_sequencing_and_filtered_environments(self):
        self.prepare({'AAPL': 'wait', 'MSFT': 'success'})
        parent_script = Path(self.temp.name) / 'parent.cjs'
        parent_script.write_text("const {spawn}=require('child_process'); const fs=require('fs');\n"
                                 "const cfg=JSON.parse(fs.readFileSync(process.argv[2]));\n"
                                 "const p=spawn(cfg.python,cfg.args,{env:process.env,detached:true,windowsHide:true,stdio:'ignore'});p.unref();setInterval(()=>{},1000);\n")
        # Fixture launch config contains only executable/paths/budget, no keys.
        cfg = Path(self.temp.name) / 'launch.json'
        atomic_json(cfg, dict(python=sys.executable, args=[str(ROOT / 'test/desk_fixture_supervisor.py'), str(self.directory), '8']))
        parent = subprocess.Popen([shutil.which('node'), str(parent_script), str(cfg)], env=graph_env(self.env))
        self.children.append(parent)
        until(lambda: (self.directory / 'seen-AAPL.json').exists())
        first = control(self.directory)
        self.assertEqual(first['activeTicker'], 'AAPL')
        parent.kill(); parent.wait(timeout=5)  # restart the creating Node process mid-graph
        self.assertEqual(first['deadline'], control(self.directory)['deadline'])
        self.assertFalse((self.directory / 'seen-MSFT.json').exists())
        (self.directory / 'release-AAPL').touch()
        final = self.finished()
        self.assertEqual(final['status'], 'completed')
        self.assertEqual([r['signal'] for r in final['results']], ['Buy', 'Sell'])
        self.assertEqual([r['ticker'] for r in final['results']], ['AAPL', 'MSFT'])
        self.assertLessEqual(final['results'][0]['finishedAt'], final['results'][1]['startedAt'])
        self.assertEqual(control(self.directory), final)  # no rewrite/revision churn
        for ticker in ('AAPL', 'MSFT'):
            seen = json.loads((self.directory / f'seen-{ticker}.json').read_text())
            for key in ('DATABASE_URL', 'NEXTAUTH_SECRET', 'WEBULL_APP_SECRET_PROD', 'FUTURE_SECRET', 'OPENAI_API_KEY'):
                self.assertNotIn(key, seen['envNames'])
            self.assertEqual(seen['args']['data_cache_dir'], str(self.directory.parent / 'cache'))
            self.assertEqual(seen['args']['memory_log_path'], str(self.directory.parent / 'trading_memory.md'))
        for file in self.directory.iterdir():
            if file.is_file():
                text = file.read_text()
                for secret in ('sentinel-router', 'sentinel-fred', 'proxy-password', 'sentinel-db', 'sentinel-broker'):
                    self.assertNotIn(secret, text, file.name)

    def test_timeout_without_node_preserves_start_deadline_and_stops_descendants(self):
        self.prepare({'AAPL': 'stall', 'MSFT': 'success'})
        child = self.launch(.7)
        until(lambda: (self.directory / 'heartbeat-AAPL').exists())
        deadline = control(self.directory)['deadline']
        final = self.finished()
        child.wait(timeout=5)
        self.assertEqual(final['deadline'], deadline)
        self.assertIn('timed out', final['error'])
        self.assertEqual([r['status'] for r in final['results']], ['failed', 'skipped'])
        self.assertFalse((self.directory / 'seen-MSFT.json').exists())
        self.assert_heartbeat_stopped('AAPL')

    def assert_heartbeat_stopped(self, ticker):
        file = self.directory / f'heartbeat-{ticker}'
        time.sleep(.2)
        before = file.read_text()
        time.sleep(.2)
        self.assertEqual(before, file.read_text())

    def test_cancel_is_terminal_and_only_owned_job_is_stopped(self):
        self.prepare({'AAPL': 'success', 'MSFT': 'stall', 'NVDA': 'success'})
        child = self.launch()
        until(lambda: (self.directory / 'heartbeat-MSFT').exists())
        # A forged legacy PID cannot target an unrelated live process.
        unrelated = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(20)'], env=runtime_env())
        try:
            (self.directory / 'pid').write_text(str(unrelated.pid))
            with concurrent.futures.ThreadPoolExecutor(4) as pool:
                states = list(pool.map(lambda _: control(self.directory, cancel=True), range(4)))
            child.wait(timeout=5)
            self.assertTrue(all(s['status'] == 'cancelled' for s in states))
            self.assertEqual([r['status'] for r in self.state()['results']], ['completed', 'cancelled', 'skipped'])
            self.assertIsNone(unrelated.poll())
            self.assertFalse((self.directory / 'seen-NVDA.json').exists())
            self.assert_heartbeat_stopped('MSFT')
            again = self.launch(); again.wait(timeout=5)
            self.assertEqual(control(self.directory)['status'], 'cancelled')
        finally:
            unrelated.kill(); unrelated.wait()

    def test_cancel_before_first_spawn(self):
        self.prepare({'AAPL': 'success'})
        control(self.directory, cancel=True)
        self.launch().wait(timeout=5)
        self.assertFalse((self.directory / 'seen-AAPL.json').exists())
        self.assertEqual(self.finished()['status'], 'cancelled')

    def test_cancel_races_completion_and_expired_deadline_without_losing_first_report(self):
        for expired in (False, True):
            with self.subTest(expired=expired):
                self.directory = self.directory.parent / ('race-deadline' if expired else 'race-completion')
                self.directory.mkdir()
                m = self.prepare({'AAPL': 'success', 'MSFT': 'wait'})
                m['id'] = self.directory.name
                atomic_json(self.directory / 'manifest.json', m)
                atomic_json(self.directory / 'state.json', empty(m))
                child = self.launch(2 if expired else 8)
                until(lambda: (self.directory / 'heartbeat-MSFT').exists())
                deadline = self.state()['deadline']
                barrier = threading.Barrier(3)

                def cancel():
                    barrier.wait(timeout=5)
                    return control(self.directory, cancel=True)

                def release():
                    barrier.wait(timeout=5)
                    (self.directory / 'release-MSFT').touch()

                # Hold the actual commit/cancel lock until both contenders exist;
                # for the deadline case let the original budget expire under it.
                with concurrent.futures.ThreadPoolExecutor(2) as pool:
                    with Lock(self.directory / 'control.lock'):
                        cancellation = pool.submit(cancel)
                        completion = pool.submit(release)
                        if expired:
                            until(lambda: time.time() > deadline)
                        barrier.wait(timeout=5)
                    cancellation.result(timeout=8)
                    completion.result(timeout=8)
                child.wait(timeout=8)
                final = self.finished()
                self.assertIn(final['status'], ('failed', 'cancelled') if expired else ('completed', 'cancelled'))
                self.assertEqual(final['deadline'], deadline)
                self.assertEqual(final['results'][0]['status'], 'completed')
                self.assertIn('AAPL distinct memo', final['results'][0]['finalState']['market_report'])
                self.assertEqual(control(self.directory, cancel=True), final)
                self.assertEqual(control(self.directory), final)
                self.assert_heartbeat_stopped('MSFT')

    def test_supervisor_death_is_interruption_and_kills_owned_descendants(self):
        self.prepare({'AAPL': 'success', 'MSFT': 'stall', 'NVDA': 'success'})
        child = self.launch()
        until(lambda: (self.directory / 'heartbeat-MSFT').exists())
        child.kill(); child.wait()
        final = self.finished()
        self.assertEqual(final['status'], 'failed')
        self.assertIn('interrupted', final['error'])
        self.assertEqual([r['status'] for r in final['results']], ['completed', 'failed', 'skipped'])
        self.assert_heartbeat_stopped('MSFT')
        self.launch().wait(timeout=5)
        self.assertFalse((self.directory / 'seen-NVDA.json').exists())

    def test_missing_corrupt_output_and_early_exit_keep_prior_success(self):
        for mode in ('missing', 'corrupt', 'crash', 'error'):
            with self.subTest(mode=mode):
                if (self.directory / 'manifest.json').exists():
                    # Separate run directory, never recycle supervisor artifacts.
                    self.directory = self.directory.parent / ('run-' + mode)
                    self.directory.mkdir()
                self.prepare({'AAPL': 'success', 'MSFT': mode, 'NVDA': 'success'})
                m = json.loads((self.directory / 'manifest.json').read_text()); m['id'] = self.directory.name
                atomic_json(self.directory / 'manifest.json', m); atomic_json(self.directory / 'state.json', empty(m))
                self.launch().wait(timeout=8)
                final = self.finished()
                self.assertEqual([r['status'] for r in final['results']], ['completed', 'failed', 'skipped'])
                self.assertIn('AAPL distinct memo', final['results'][0]['finalState']['market_report'])

    def test_corrupt_or_missing_state_recovers_receipts_but_never_raw_outputs(self):
        self.prepare({'AAPL': 'success', 'MSFT': 'stall'})
        child = self.launch()
        until(lambda: (self.directory / 'heartbeat-MSFT').exists())
        child.kill(); child.wait()
        (self.directory / 'state.json').write_text('{corrupt')
        final = self.finished()
        self.assertEqual(final['results'][0]['status'], 'completed')
        self.assertEqual(final['status'], 'failed')
        self.assertIn('corrupt', final['error'])
        (self.directory / 'state.json').unlink()
        self.assertEqual(self.finished()['results'][0]['status'], 'completed')

    def test_live_cached_loop_observes_corruption_without_a_control_reader(self):
        self.prepare({'AAPL': 'success', 'MSFT': 'stall'})
        child = self.launch()
        until(lambda: (self.directory / 'heartbeat-MSFT').exists())
        with Lock(self.directory / 'control.lock'):
            (self.directory / 'state.json').write_text('{broken')
        # No snapshot helper may mask a missed invalidation in the owned loop.
        child.wait(timeout=5)
        self.assert_heartbeat_stopped('MSFT')
        final = self.finished()
        self.assertEqual(final['status'], 'failed')
        self.assertEqual(final['results'][0]['status'], 'completed')

    def test_cached_loop_checks_cancel_marker_even_without_state_change(self):
        self.prepare({'AAPL': 'stall'})
        child = self.launch()
        until(lambda: (self.directory / 'heartbeat-AAPL').exists())
        before = (self.directory / 'state.json').read_bytes()
        with Lock(self.directory / 'control.lock'):
            atomic_json(self.directory / 'cancel.json', {'reason': 'synthetic control interruption'})
        child.wait(timeout=5)
        self.assertEqual((self.directory / 'state.json').read_bytes(), before)
        self.assert_heartbeat_stopped('AAPL')

    def test_duplicate_supervisor_cannot_replay_live_job(self):
        self.prepare({'AAPL': 'stall'})
        self.launch()
        until(lambda: (self.directory / 'seen-AAPL.json').exists())
        first = control(self.directory)
        duplicate = self.launch(); duplicate.wait(timeout=5)
        self.assertNotEqual(duplicate.returncode, 0)
        self.assertEqual(first['deadline'], control(self.directory)['deadline'])

    def test_expired_unclaimed_state_cannot_reset_deadline_or_replay(self):
        self.prepare({'AAPL': 'success'})
        s = self.state()
        s.update(status='running', activeTicker='AAPL', deadline=time.time() - 10)
        s['results'][0]['status'] = 'running'
        atomic_json(self.directory / 'state.json', s)
        self.launch().wait(timeout=5)
        final = self.finished()
        self.assertEqual(final['deadline'], s['deadline'])
        self.assertEqual(final['status'], 'failed')
        self.assertFalse((self.directory / 'seen-AAPL.json').exists())

    def test_receipt_survives_death_between_receipt_and_state_commit(self):
        m = self.prepare({'AAPL': 'success', 'MSFT': 'stall'})
        initial = self.state()
        child = self.launch()
        until(lambda: (self.directory / 'heartbeat-MSFT').exists())
        child.kill(); child.wait()
        initial.update(status='running', activeTicker='AAPL', deadline=time.time() - 1)
        initial['results'][0]['status'] = 'running'
        atomic_json(self.directory / 'state.json', initial)
        final = self.finished()
        self.assertEqual(final['results'][0]['status'], 'completed')
        self.assertEqual(final['status'], 'failed')

    def test_corrupt_manifest_stops_live_job_and_retains_committed_reports(self):
        self.prepare({'AAPL': 'success', 'MSFT': 'stall'})
        child = self.launch()
        until(lambda: (self.directory / 'heartbeat-MSFT').exists())
        (self.directory / 'manifest.json').write_text('{broken')
        final = self.finished()
        child.wait(timeout=5)
        self.assertEqual(final['results'][0]['status'], 'completed')
        self.assertEqual(final['status'], 'failed')
        self.assertEqual(control(self.directory), final)
        self.assert_heartbeat_stopped('MSFT')

    def test_spawn_failure_is_terminal_without_unhandled_callback(self):
        self.prepare({'AAPL': 'success'})
        from unittest.mock import patch
        from desk_supervisor import supervise
        with patch('desk_supervisor.subprocess.Popen', side_effect=OSError('sentinel-router')):
            supervise(self.directory)
        final = self.finished()
        self.assertEqual(final['status'], 'failed')
        self.assertNotIn('sentinel-router', final['error'])

    def test_structurally_corrupt_completion_never_becomes_success(self):
        self.prepare({'AAPL': 'success'})
        s = self.state()
        s['status'] = 'completed'
        s['results'][0].update(status='completed', finalState={}, signal='Buy')
        atomic_json(self.directory / 'state.json', s)
        final = self.finished()
        self.assertEqual(final['status'], 'failed')
        self.assertIn('corrupt', final['error'])

    def test_review_and_cancel_after_completed_do_not_change_completion(self):
        self.prepare({'AAPL': 'review', 'MSFT': 'success'})
        self.launch().wait(timeout=8)
        final = self.finished()
        self.assertEqual(final['status'], 'review')
        self.assertEqual(final['results'][0]['signal'], 'REVIEW')
        self.assertEqual(control(self.directory, cancel=True), final)


if __name__ == '__main__':
    unittest.main()
