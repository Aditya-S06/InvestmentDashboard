"""One detached, non-replaying Desk supervisor per run, plus keyless controls.

State/receipt replacement is atomic. Lifetime locks establish ownership without
PID reuse races; operation locks linearize spawn, cancel, completion and reads.
Only `run` receives provider environments. Control invocations receive runtime
support only. No process environment is serialized, and no key is a CLI argument.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time

from desk_process import Lock, WindowsJob, atomic_json, graph_env, redact, safe_path

TERMINAL = ('completed', 'review', 'failed', 'cancelled')
BUDGETS = {'fast': 90, 'standard': 180, 'deep': 300}
INTERRUPTED = 'Desk supervisor interrupted; no automatic replay. Re-run with fresh authentication. Checkpoint resumability is not verified.'
FIELDS = ('company_of_interest', 'trade_date', 'asset_type', 'market_report',
          'sentiment_report', 'news_report', 'fundamentals_report', 'investment_plan',
          'trader_investment_plan', 'trader_investment_decision', 'final_trade_decision')
NESTED = {
    'investment_debate_state': ('bull_history', 'bear_history', 'history', 'current_response', 'judge_decision', 'count'),
    'risk_debate_state': ('aggressive_history', 'conservative_history', 'neutral_history', 'history', 'latest_speaker', 'judge_decision', 'count'),
}


def now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def read(path):
    with safe_path(path).open(encoding='utf-8') as stream:
        return json.load(stream)


def manifest_at(directory):
    m = read(directory / 'manifest.json')
    if (not isinstance(m, dict) or m.get('version') != 1 or not re.fullmatch(r'[a-f0-9]{32}', m.get('jobId', ''))
            or m.get('id') != directory.name or m.get('userId') != directory.parent.name
            or m.get('depth') not in BUDGETS or not 1 <= len(m.get('tickers', [])) <= 3):
        raise ValueError('Invalid Desk manifest')
    for ticker in m['tickers']:
        if (not re.fullmatch(r'[A-Z0-9.^][A-Z0-9._^=+\-]{0,9}', ticker) or ticker.endswith('.')
                or re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', ticker)):
            raise ValueError('Invalid ticker')
    datetime.strptime(m['asOf'], '%Y-%m-%d')
    if datetime.fromisoformat(m['createdAt'].replace('Z', '+00:00')).tzinfo is None:
        raise ValueError('Invalid launch timestamp')
    if (m.get('assetType') not in ('stock', 'crypto') or not isinstance(m.get('checkpoint'), bool)
            or not m.get('analysts') or any(a not in ('market', 'social', 'news', 'fundamentals') for a in m['analysts'])):
        raise ValueError('Invalid graph settings')
    return m


def empty(m):
    return dict(version=1, jobId=m['jobId'], id=m['id'], userId=m['userId'], revision=0,
                status='queued', activeTicker=None, deadline=None, error=None, finishedAt=None,
                results=[dict(ticker=t, status='queued', signal=None, finalState=None,
                              error=None, startedAt=None, finishedAt=None) for t in m['tickers']])


def valid_result(row, ticker):
    if (not isinstance(row, dict) or row.get('ticker') != ticker or
            row.get('status') not in ('queued', 'running', 'completed', 'review', 'failed', 'cancelled', 'skipped')):
        return False
    if row['status'] not in ('completed', 'review'):
        return True
    state = row.get('finalState')
    if (not isinstance(state, dict) or not any(k in FIELDS or k in NESTED for k in state)
            or state.get('company_of_interest', ticker) != ticker
            or row.get('signal') not in ('Buy', 'Overweight', 'Hold', 'Underweight', 'Sell', 'REVIEW')
            or (row['status'] == 'review') != (row['signal'] == 'REVIEW')):
        return False
    try:
        for field in ('startedAt', 'finishedAt'):
            if datetime.fromisoformat(row[field].replace('Z', '+00:00')).tzinfo is None:
                return False
    except (KeyError, ValueError, AttributeError, TypeError):
        return False
    return True


def recover_receipts(directory, m, s):
    for i, ticker in enumerate(m['tickers']):
        try:
            receipt = read(directory / f'result-{i}.json')
            row = receipt['result']
            if receipt['jobId'] != m['jobId'] or not valid_result(row, ticker) or row['status'] not in ('completed', 'review'):
                break
            s['results'][i] = row
        except (OSError, ValueError, KeyError, TypeError):
            break


def state_at(directory, m):
    try:
        s = read(directory / 'state.json')
        if (s['version'] != 1 or s['jobId'] != m['jobId'] or s['id'] != m['id'] or s['userId'] != m['userId']
                or not isinstance(s['revision'], int) or s['revision'] < 0
                or s['status'] not in (*TERMINAL, 'queued', 'running')
                or (s['status'] == 'running' and (s.get('activeTicker') not in m['tickers']
                    or not isinstance(s.get('deadline'), (int, float))))
                or len(s['results']) != len(m['tickers'])
                or not all(valid_result(r, t) for r, t in zip(s['results'], m['tickers']))
                or (s['status'] in ('completed', 'review') and
                    not all(r['status'] in ('completed', 'review') for r in s['results']))):
            raise ValueError('Invalid state')
        # Also cover death between receipt replacement and state replacement.
        recover_receipts(directory, m, s)
        return s
    except (OSError, ValueError, KeyError, TypeError):
        s = empty(m)
        # Receipts are written only after a zero exit and validated output. Raw
        # out files are never treated as proof that interrupted work completed.
        recover_receipts(directory, m, s)
        stop_state(s, 'failed', 'Desk durable state missing or corrupt. ' + INTERRUPTED)
        return s


def save(directory, s):
    s['revision'] = max(s['revision'] + 1, time.time_ns() // 1_000_000)
    atomic_json(directory / 'state.json', s)


class StateWatch:
    """Owned-loop cache only. Call under control.lock; controls/restart always read fresh.

    Atomic replacements change inode/ctime/mtime/size. Include receipts so death
    between receipt and state publication retains the same recovery semantics.
    No report bytes are reparsed until a file changes. Cancellation is checked
    separately on EVERY loop, before consulting this cache.
    """
    def __init__(self, directory, manifest, state):
        self.directory, self.manifest, self.state = directory, manifest, state
        self.stamp = self.fingerprint()

    def fingerprint(self):
        result = []
        for name in ['state.json', *[f'result-{i}.json' for i in range(len(self.manifest['tickers']))]]:
            try:
                stat = safe_path(self.directory / name).stat()
                result.append((stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns))
            except FileNotFoundError:
                result.append(None)
        return tuple(result)

    def current(self):
        stamp = self.fingerprint()
        if stamp != self.stamp:
            self.state = state_at(self.directory, self.manifest)
            self.stamp = stamp
        return self.state


def stop_state(s, status, message):
    s.update(status=status, error=message, finishedAt=now())
    active = s.get('activeTicker') or next((r['ticker'] for r in s['results'] if r['status'] == 'queued'), None)
    for row in s['results']:
        if row['status'] not in ('completed', 'review'):
            row.update(status=status if row['ticker'] == active else 'skipped',
                       error=message if row['ticker'] == active else 'Not started because the run stopped',
                       finishedAt=s['finishedAt'])


def alive(directory):
    try:
        with Lock(directory / 'owner.lock', wait=0):
            return False
    except TimeoutError:
        return True


def control(directory, cancel=False):
    directory = safe_path(directory)
    if not directory.is_dir():
        return None
    with Lock(directory / 'control.lock'):
        try:
            m = manifest_at(directory)
        except (OSError, ValueError, KeyError, TypeError):
            # A marker also stops a surviving supervisor whose manifest was lost.
            atomic_json(directory / 'cancel.json', {'reason': 'unreadable manifest'})
            try:
                previous = read(directory / 'state.json')
                if (previous['id'] != directory.name or previous['userId'] != directory.parent.name
                        or not re.fullmatch(r'[a-f0-9]{32}', previous['jobId'])
                        or not 1 <= len(previous['results']) <= 3):
                    return None
                # State carries its own scoped identity. Recover reports only;
                # missing launch settings can never authorize another graph.
                recovery = dict(id=previous['id'], userId=previous['userId'], jobId=previous['jobId'],
                                tickers=[r['ticker'] for r in previous['results']])
                s = state_at(directory, recovery)
                if s['status'] in TERMINAL and s['revision'] > 0:
                    return s
                stop_state(s, 'cancelled' if cancel else 'failed', None if cancel else 'Desk manifest missing or corrupt. ' + INTERRUPTED)
                save(directory, s)
                return s
            except (OSError, ValueError, KeyError, TypeError):
                return None
        s = state_at(directory, m)
        live = alive(directory)
        if s['status'] not in TERMINAL:
            if cancel:
                atomic_json(directory / 'cancel.json', {'jobId': m['jobId']})
                stop_state(s, 'cancelled', None)
                save(directory, s)
            elif not live:
                # Allow only initial launch, never restart a claimed supervisor.
                age = time.time() - datetime.fromisoformat(m['createdAt'].replace('Z', '+00:00')).timestamp()
                if (directory / 'claimed').exists() or age >= 15:
                    stop_state(s, 'failed', INTERRUPTED)
                    save(directory, s)
        elif not (directory / 'state.json').exists() or s['revision'] == 0:
            save(directory, s)
        return s


def pump(stream, destination, errors):
    try:
        with safe_path(destination).open('a', encoding='utf-8') as output:
            while True:
                line = stream.readline(65537)
                if not line:
                    break
                if len(line) > 65536:
                    while line and not line.endswith(b'\n'):
                        line = stream.readline(65537)
                    continue  # never persist partial secret-bearing log lines
                text = redact(line.decode('utf-8', 'replace'))
                try:
                    event = json.loads(text)
                    if isinstance(event, dict) and event.get('event') == 'error':
                        errors.append('Desk graph reported an error')
                except ValueError:
                    pass
                output.write(text)
                output.flush()
    except OSError:
        errors.append('Desk log persistence failed')
    finally:
        stream.close()


def ticker_output(file, ticker, as_of):
    payload = read(file)
    source = payload['finalState']
    if not isinstance(source, dict):
        raise ValueError('Invalid ticker result')
    state = {k: v for k, v in source.items() if k in FIELDS and isinstance(v, str)}
    for key, fields in NESTED.items():
        if isinstance(source.get(key), dict):
            state[key] = {k: v for k, v in source[key].items() if k in fields and
                          (isinstance(v, str) or (k == 'count' and isinstance(v, (int, float))))}
    if (not state or state.get('company_of_interest', ticker) != ticker or
            state.get('trade_date', as_of) != as_of):
        raise ValueError('Mismatched ticker result')
    signals = {s.upper(): s for s in ('Buy', 'Overweight', 'Hold', 'Underweight', 'Sell', 'REVIEW')}
    rating = signals.get(str(payload.get('signal', '')).strip().upper(), 'REVIEW')
    return json.loads(redact(json.dumps(dict(signal=rating, finalState=state))))


def supervise(directory, *, graph_script=None, budget=None):
    """Test seams are Python arguments only, never production env/CLI settings."""
    directory = safe_path(directory)
    with Lock(directory / 'owner.lock', wait=0):
        with Lock(directory / 'control.lock'):
            m = manifest_at(directory)
            s = state_at(directory, m)
            if s['status'] in TERMINAL or (directory / 'cancel.json').exists():
                return
            if s['status'] != 'queued' or s.get('deadline') is not None or any(r['status'] != 'queued' for r in s['results']):
                stop_state(s, 'failed', INTERRUPTED)
                save(directory, s)
                return  # even a missing claim can never reset a prior deadline
            try:
                safe_path(directory / 'claimed').open('x').close()
            except FileExistsError:
                return  # never replay an interrupted job
        script = graph_script or Path(__file__).with_name('trading_desk_runner.py')
        for index, ticker in enumerate(m['tickers']):
            child, job, threads = None, WindowsJob(), []
            errors = []
            try:
                with Lock(directory / 'control.lock'):
                    s = state_at(directory, m)
                    if s['status'] in TERMINAL or (directory / 'cancel.json').exists():
                        return
                    wall = BUDGETS[m['depth']] if budget is None else budget
                    start = time.time()
                    monotonic_deadline = time.monotonic() + wall
                    s.update(status='running', activeTicker=ticker, deadline=start + wall)
                    s['results'][index].update(status='running', startedAt=now())
                    save(directory, s)  # deadline is durable BEFORE any graph runs
                    out = safe_path(directory / f'out-{ticker}.json')
                    exit_file = safe_path(directory / f'exit-{index}.json')
                    if out.exists() or exit_file.exists():
                        raise ValueError('Refusing stale graph artifacts')
                    args = [sys.executable, str(Path(__file__).with_name('desk_graph_host.py')), str(exit_file),
                            str(script), '--ticker', ticker, '--as-of', m['asOf'], '--depth', m['depth'],
                            '--analysts', ','.join(m['analysts']), '--asset-type', m['assetType'],
                            '--checkpoint', str(m['checkpoint']).lower(), '--out', str(out),
                            '--results-dir', str(directory), '--memory-log-path', str(directory.parent / 'trading_memory.md'),
                            '--data-cache-dir', str(directory.parent / 'cache')]
                    child = subprocess.Popen(args, env=graph_env(), stdin=subprocess.PIPE,
                                             stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                             start_new_session=os.name != 'nt',
                                             creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
                    job.assign(child)  # gate prevents provider work before containment
                    for stream, filename in ((child.stdout, 'events.jsonl'), (child.stderr, 'stderr.log')):
                        thread = threading.Thread(target=pump, args=(stream, directory / filename, errors), daemon=True)
                        thread.start()
                        threads.append(thread)
                    child.stdin.write(b'start\n')
                    child.stdin.flush()
                    watch = StateWatch(directory, m, s)
                reason = None
                while True:
                    with Lock(directory / 'control.lock'):
                        if (directory / 'cancel.json').exists():
                            return
                        latest = watch.current()
                        if latest['status'] in TERMINAL:
                            return
                    if time.monotonic() >= monotonic_deadline or time.time() >= s['deadline']:
                        reason = f'Desk run timed out after {wall:g}s ({m["depth"]}) while analyzing {ticker}.'
                        if m['checkpoint']:
                            reason += ' Checkpoint enabled; resumability must be verified before a fresh authenticated re-run.'
                        break
                    if exit_file.exists():
                        if read(exit_file).get('code') != 0:
                            reason = 'Desk graph exited unsuccessfully'
                        break
                    if child.poll() is not None:
                        reason = 'Desk graph exited before recording its result'
                        break
                    time.sleep(.05)
                # Release owned handles/lease, reap, and drain logs before committing.
                stop_child(child, job)
                for thread in threads:
                    thread.join(timeout=3)
                if any(t.is_alive() for t in threads):
                    reason = 'Desk graph output did not close'
                if errors:
                    reason = reason or errors[0]
                with Lock(directory / 'control.lock'):
                    s = state_at(directory, m)
                    if s['status'] in TERMINAL or (directory / 'cancel.json').exists():
                        return
                    if reason:
                        stop_state(s, 'failed', reason)
                    else:
                        payload = ticker_output(out, ticker, m['asOf'])
                        atomic_json(out, payload)
                        row = s['results'][index]
                        row.update(status='review' if payload['signal'] == 'REVIEW' else 'completed',
                                   **payload, finishedAt=now(), error=None)
                        atomic_json(directory / f'result-{index}.json', {'jobId': m['jobId'], 'result': row})
                        if index == len(m['tickers']) - 1:
                            s.update(status='review' if any(r['status'] == 'review' for r in s['results']) else 'completed',
                                     finishedAt=now(), error=None)
                    save(directory, s)
                    if s['status'] in TERMINAL:
                        return
            except Exception:
                # Diagnostics deliberately omit raw exceptions/argv/environments.
                with Lock(directory / 'control.lock'):
                    s = state_at(directory, m)
                    if s['status'] not in TERMINAL:
                        stop_state(s, 'failed', 'Desk graph could not start or produced a missing, corrupt or mismatched result')
                        save(directory, s)
                return
            finally:
                stop_child(child, job)
                for thread in threads:
                    thread.join(timeout=3)


def stop_child(child, job):
    job.close()
    if child:
        if child.stdin and not child.stdin.closed:
            child.stdin.close()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            # Popen retains the Windows handle; POSIX fallback intentionally does
            # not signal a potentially reused PID. Report containment failure.
            raise RuntimeError('Desk graph lease did not close') from None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=('run', 'snapshot', 'cancel'))
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    try:
        if args.command == 'run':
            supervise(args.directory)
        else:
            print(json.dumps(control(args.directory, cancel=args.command == 'cancel')))
        return 0
    except Exception:
        # Control failure is retryable and must never masquerade as dead ownership.
        print('Desk local supervision unavailable', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
