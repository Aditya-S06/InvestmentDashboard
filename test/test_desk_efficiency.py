"""Synthetic supervisor I/O measurements; isolated files, no graph/provider/DB."""
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import desk_supervisor as supervisor
from desk_process import Lock, atomic_json


class EfficiencyTests(unittest.TestCase):
    def test_idle_loop_read_volume(self):
        for size in (128 * 1024, 1024 * 1024):
            with tempfile.TemporaryDirectory(prefix='desk16-') as temp:
                directory = Path(temp)
                m = dict(version=1, jobId='a' * 32, id=directory.name, userId=directory.parent.name,
                         tickers=['AAPL', 'MSFT', 'NVDA'])
                state = supervisor.empty(m)
                state.update(status='running', activeTicker='NVDA', deadline=time.time() + 300)
                for i in range(2):
                    state['results'][i].update(status='completed', signal='Buy',
                        startedAt=supervisor.now(), finishedAt=supervisor.now(),
                        finalState=dict(company_of_interest=m['tickers'][i], market_report='x' * size))
                    atomic_json(directory / f'result-{i}.json', dict(jobId=m['jobId'], result=state['results'][i]))
                supervisor.save(directory, state)
                read = supervisor.read
                counts = dict(attempts=0, reads=0, bytes=0)
                def counted(file):
                    counts['attempts'] += 1
                    if file.exists():
                        counts['reads'] += 1
                        counts['bytes'] += file.stat().st_size
                    return read(file)
                watch = supervisor.StateWatch(directory, m, state)
                # Keep an executable reference for the original loop's full recovery.
                for mode in ('full-recovery reference', 'cached loop'):
                    counts = dict(attempts=0, reads=0, bytes=0)
                    start = time.perf_counter()
                    with patch.object(supervisor, 'read', side_effect=counted):
                        for _ in range(100):
                            with Lock(directory / 'control.lock'):
                                self.assertFalse((directory / 'cancel.json').exists())
                                current = watch.current() if mode == 'cached loop' else supervisor.state_at(directory, m)
                                self.assertEqual(current['deadline'], state['deadline'])
                    print(json.dumps(dict(workload='100 idle loop checks', mode=mode, report_bytes=size,
                                          **counts, seconds=round(time.perf_counter() - start, 4))), flush=True)
                    if mode == 'cached loop':
                        self.assertEqual(counts, dict(attempts=0, reads=0, bytes=0))
                    else:
                        self.assertEqual(counts['attempts'], 400)
                        self.assertEqual(counts['reads'], 300)

    def test_changes_recover_receipts_and_corrupt_state_without_reusing_stale_cache(self):
        with tempfile.TemporaryDirectory(prefix='desk16-recover-') as temp:
            directory = Path(temp)
            m = dict(version=1, jobId='b' * 32, id=directory.name, userId=directory.parent.name, tickers=['AAPL', 'MSFT'])
            state = supervisor.empty(m)
            state.update(status='running', activeTicker='AAPL', deadline=time.time() + 300)
            supervisor.save(directory, state)
            with Lock(directory / 'control.lock'):
                watch = supervisor.StateWatch(directory, m, state)
                row = dict(state['results'][0], status='completed', signal='Buy',
                           startedAt=supervisor.now(), finishedAt=supervisor.now(),
                           finalState=dict(market_report='retained receipt'))
                # Receipt published before state commit is noticed by the fast loop.
                atomic_json(directory / 'result-0.json', dict(jobId=m['jobId'], result=row))
                self.assertEqual(watch.current()['results'][0], row)
                (directory / 'state.json').write_text('{broken', encoding='utf-8')
                recovered = watch.current()
                self.assertEqual(recovered['status'], 'failed')
                self.assertEqual(recovered['results'][0], row)
                # A new watch/control has no cached state to hide corruption.
                fresh = supervisor.state_at(directory, m)
                self.assertEqual(fresh['results'][0], row)
                self.assertEqual(fresh['status'], 'failed')
                (directory / 'result-0.json').write_text('{bad', encoding='utf-8')
                self.assertNotEqual(watch.current()['results'][0]['status'], 'completed')
                atomic_json(directory / 'result-0.json', dict(jobId=m['jobId'], result=row))
                self.assertEqual(watch.current()['results'][0], row)
                (directory / 'state.json').unlink()
                self.assertEqual(watch.current()['results'][0], row)

    def test_atomic_state_replacement_and_in_place_corruption_invalidate_watch(self):
        with tempfile.TemporaryDirectory(prefix='desk16-state-') as temp:
            directory = Path(temp)
            m = dict(version=1, jobId='c' * 32, id=directory.name, userId=directory.parent.name, tickers=['AAPL'])
            state = supervisor.empty(m)
            state.update(status='running', activeTicker='AAPL', deadline=time.time() + 300)
            supervisor.save(directory, state)
            with Lock(directory / 'control.lock'):
                watch = supervisor.StateWatch(directory, m, state)
                cancelled = json.loads(json.dumps(state))
                supervisor.stop_state(cancelled, 'cancelled', None)
                supervisor.save(directory, cancelled)
                self.assertEqual(watch.current()['status'], 'cancelled')
                # Same length in-place overwrite still changes the metadata signature.
                file = directory / 'state.json'
                file.write_bytes(b'!' * file.stat().st_size)
                self.assertEqual(watch.current()['status'], 'failed')


if __name__ == '__main__':
    unittest.main()
