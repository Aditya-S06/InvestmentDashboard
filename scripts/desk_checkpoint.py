"""App adapter for the pinned upstream graph/checkpointer; never constructs a provider.

The keyless control process holds the user's mutation lock across Node's DB and
launch operations. An unacknowledged launch leaves a conservative durable fence.
Lock files are permanent, as in desk-9.
"""
import argparse
from contextlib import closing, contextmanager
from datetime import datetime
import json
from pathlib import Path
import re
import sqlite3
import sys
from types import SimpleNamespace
import uuid

from desk_process import Lock, atomic_json, safe_path
from desk_supervisor import alive, control, manifest_at, read

ORDER = ('market', 'social', 'news', 'fundamentals')
ROUNDS = {'fast': 1, 'standard': 3, 'deep': 5}
CONFIG_FIELDS = ('deep_think_llm', 'quick_think_llm', 'output_language',
                 'benchmark_ticker', 'temperature', 'llm_max_retries', 'max_tokens')


class CheckpointNotFound(ValueError):
    pass


def ticker_value(ticker):
    if (not isinstance(ticker, str) or not re.fullmatch(r'[A-Z0-9.^][A-Z0-9._^=+\-]{0,9}', ticker)
            or ticker.endswith('.') or re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', ticker)):
        raise ValueError('Invalid ticker')
    return ticker


def paths(user, ticker):
    ticker_value(ticker)
    directory = safe_path(user / 'cache' / 'checkpoints')
    directory.mkdir(parents=True, exist_ok=True)
    return directory, safe_path(directory / f'{ticker}.db')


def settings(value):
    ticker = ticker_value(value['ticker'])
    date = value['asOf']
    if datetime.strptime(date, '%Y-%m-%d').strftime('%Y-%m-%d') != date:
        raise ValueError('Invalid date')
    depth, asset = value['depth'], value['assetType']
    if depth not in ROUNDS or asset not in ('stock', 'crypto'):
        raise ValueError('Invalid settings')
    analysts = [a for a in ORDER if a in value['analysts']]
    if not analysts or set(analysts) != set(value['analysts']) or (asset == 'crypto' and 'fundamentals' in analysts):
        raise ValueError('Invalid analysts')
    return dict(ticker=ticker, asOf=date, depth=depth, assetType=asset, analysts=analysts)


def upstream():
    # Must precede *all* upstream imports, including default_config.
    import dotenv
    dotenv.load_dotenv = lambda *a, **kw: False
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'TradingAgents'))
    from tradingagents.graph.trading_graph import TradingAgentsGraph
    from tradingagents.graph.checkpointer import thread_id
    return TradingAgentsGraph, thread_id


def identity(value):
    graph_type, thread_id = upstream()
    value = settings(value)
    shape = SimpleNamespace(selected_analysts=tuple(value['analysts']), config={
        'max_debate_rounds': ROUNDS[value['depth']], 'max_risk_discuss_rounds': ROUNDS[value['depth']]})
    # Call the pinned implementation; no copied signature/hash algorithm.
    signature = graph_type._run_signature(shape, value['assetType'])
    return thread_id(value['ticker'], value['asOf'], signature)


def inspection_workflow(value):
    graph_type, _ = upstream()
    from tradingagents.graph.setup import GraphSetup
    from tradingagents.graph.conditional_logic import ConditionalLogic
    # Upstream factories capture LLMs in node closures. get_state never invokes
    # nodes, so inspection needs neither provider clients nor credentials.
    tools = graph_type._create_tool_nodes(None)
    rounds = ROUNDS[value['depth']]
    return GraphSetup(None, None, tools, ConditionalLogic(rounds, rounds)).setup_graph(value['analysts'])


def inspect_saved(user, value):
    value = settings(value)
    _, db = paths(user, value['ticker'])
    if not db.is_file():
        return None
    tid = identity(value)
    from langgraph.checkpoint.sqlite import SqliteSaver
    # Read-only connection: listing cannot create schema/rows or repair corruption.
    with closing(sqlite3.connect(db.as_uri() + '?mode=ro', uri=True, check_same_thread=False)) as connection:
        saver = SqliteSaver(connection)
        saver.is_setup = True  # schema belongs exclusively to upstream's writer
        config = {'configurable': {'thread_id': tid}}
        cp = saver.get_tuple(config)
        if cp is None or cp.metadata.get('step') is None:
            return None
        snapshot = inspection_workflow(value).compile(checkpointer=saver).get_state(config)
        if not snapshot.next:
            return None
        return dict(**value, threadId=tid, checkpointId=cp.checkpoint['id'], step=cp.metadata['step'])


def remember(user, value, config):
    value = settings(value)
    directory, _ = paths(user, value['ticker'])
    tid = identity(value)
    destination = safe_path(directory / f'{value["ticker"]}.settings.json')
    try:
        saved = read(destination)
    except FileNotFoundError:
        saved = {}
    # Persist only these explicit non-secret choices; no URLs, keys or env dump.
    saved[tid] = {**value, 'graphSettings': {k: config.get(k) for k in CONFIG_FIELDS}}
    atomic_json(destination, saved)


def graph_settings(saved):
    values = {k: saved['graphSettings'][k] for k in CONFIG_FIELDS}
    if any(v is not None and (isinstance(v, bool) or not isinstance(v, (str, int, float))) for v in values.values()):
        raise ValueError('Invalid saved graph settings')
    if any(not isinstance(values[k], str) or not values[k].strip() for k in ('deep_think_llm', 'quick_think_llm', 'output_language')):
        raise ValueError('Missing saved model/language settings')
    return values


def listed(user, tickers):
    output = []
    for ticker in tickers:
        directory, db = paths(user, ticker)
        item = dict(ticker=ticker, checkpoints=[], reason=None, exists=db.exists())
        try:
            assert_idle(user, [ticker])
            with Lock(directory / f'{ticker}.use.lock', wait=0):
                pass
        except (ValueError, TimeoutError):
            item['reason'] = 'Ticker has active or unresolved Desk ownership; refresh after it stops.'
            output.append(item)
            continue
        try:
            saved = read(directory / f'{ticker}.settings.json') if db.exists() else {}
            for tid, value in saved.items():
                if value['ticker'] != ticker or identity(value) != tid:
                    raise ValueError('Mismatched metadata')
                graph_settings(value)
                found = inspect_saved(user, value)
                if found:
                    item['checkpoints'].append(found)
            if db.exists() and not item['checkpoints']:
                item['reason'] = 'No matching unfinished state with saved settings. Completed or empty databases cannot resume.'
        except Exception:
            item['checkpoints'] = []
            item['reason'] = 'Checkpoint or saved settings are unreadable; Resume is unavailable.'
        output.append(item)
    return output


def restore(user, reference, requested):
    ticker = ticker_value(reference['ticker'])
    directory, _ = paths(user, ticker)
    try:
        saved = read(directory / f'{ticker}.settings.json')[reference['threadId']]
    except (FileNotFoundError, KeyError):
        raise CheckpointNotFound('Saved checkpoint not found') from None
    found = inspect_saved(user, saved)
    if not found or any(found[k] != reference[k] for k in ('threadId', 'checkpointId')):
        raise ValueError('Checkpoint changed or is no longer resumable; refresh saved checkpoints.')
    if settings(requested) != settings(saved):
        raise ValueError('Resume settings differ: restore the saved ticker, date, asset, analysts and depth.')
    return graph_settings(saved)


def assert_idle(user, tickers):
    for fence in safe_path(user / 'checkpoint-launches').glob('*.json'):
        reservation = read(fence)
        if set(reservation['tickers']) & set(tickers):
            run_id = reservation.get('runId')
            if isinstance(run_id, str) and re.fullmatch(r'[a-f0-9]{32}', run_id):
                directory = safe_path(user / run_id)
                if (directory / 'manifest.json').is_file():
                    manifest = manifest_at(directory)
                    if manifest['tickers'] == reservation['tickers']:
                        snapshot = control(directory)
                        if snapshot and snapshot['status'] not in ('queued', 'running') and not alive(directory):
                            # Publication completed before Node died. Durable terminal
                            # state prevents a late supervisor from starting graph work.
                            continue
            raise ValueError('A queued launch has not acknowledged checkpoint ownership; Clear is blocked.')
    for directory in user.iterdir():
        safe_path(directory)
        if not directory.is_dir() or directory.name in ('cache', 'checkpoint-launches'):
            continue
        if not any((directory / name).exists() for name in ('manifest.json', 'owner.lock', 'launch')):
            continue
        try:
            manifest = manifest_at(directory)
        except Exception:
            # Unknown live ownership cannot safely be assigned to a ticker.
            if alive(directory):
                raise ValueError('Desk supervisor ownership is active or unreadable.') from None
            continue
        if not set(manifest['tickers']) & set(tickers):
            continue
        snapshot = control(directory)
        if alive(directory) or not snapshot or snapshot['status'] in ('queued', 'running'):
            raise ValueError('Checkpoint is in use by a queued/running Desk job or retiring supervisor.')


def clear(user, ticker):
    assert_idle(user, [ticker])
    directory, db = paths(user, ticker)
    # Held until all unlink operations finish; graph runners use the same lock.
    with Lock(directory / f'{ticker}.use.lock', wait=0):
        files = [safe_path(Path(str(db) + suffix)) for suffix in ('', '-wal', '-shm', '-journal')]
        files.append(safe_path(directory / f'{ticker}.settings.json'))
        deleted = any(file.exists() for file in files)
        for file in files:
            file.unlink(missing_ok=True)
        return dict(ticker=ticker, deleted=deleted)


@contextmanager
def graph_use(user, ticker, run_directory):
    directory, _ = paths(user, ticker)
    with Lock(directory / f'{ticker}.use.lock', wait=0):
        # A late guardian must not reopen storage after its owner has died and
        # Clear has observed interruption. Check under the same use lock.
        snapshot = control(run_directory)
        if not alive(run_directory) or not snapshot or snapshot['status'] != 'running' or snapshot['activeTicker'] != ticker:
            raise ValueError('Desk graph no longer has active supervisor ownership')
        yield


def reply(value):
    print(json.dumps(value), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('user', type=Path)
    args = parser.parse_args()
    user = safe_path(args.user)
    user.mkdir(parents=True, exist_ok=True)
    fence = None
    try:
        with Lock(user / 'checkpoint-control.lock', wait=0):
            reply({'ready': True})
            for line in sys.stdin:
                try:
                    request = json.loads(line)
                    command = request['command']
                    if command == 'release':
                        if fence:
                            fence.unlink()
                        reply({'released': True})
                        return 0
                    tickers = [ticker_value(t) for t in request.get('tickers', [])]
                    if command == 'reserve':
                        assert_idle(user, tickers)
                        directory = safe_path(user / 'checkpoint-launches')
                        directory.mkdir(exist_ok=True)
                        fence = directory / f'{uuid.uuid4().hex}.json'
                        atomic_json(fence, {'tickers': tickers, 'runId': request.get('runId')})
                        result = {'reserved': True}
                    elif command == 'list':
                        result = listed(user, tickers)
                    elif command == 'clear':
                        result = clear(user, request['ticker'])
                    elif command == 'restore':
                        restore(user, request['reference'], request['settings'])
                        result = {'matched': True}
                    else:
                        raise ValueError('Invalid checkpoint operation')
                    reply({'result': result})
                except CheckpointNotFound as exc:
                    reply({'error': str(exc), 'status': 404})
                except (ValueError, TimeoutError) as exc:
                    reply({'error': str(exc)})
                except Exception:
                    reply({'error': 'Checkpoint state unavailable; refresh or retry.'})
        # EOF/crash deliberately retains a pending-launch fence. Never guess a
        # dead DB transaction from a PID or automatically expire its reservation.
        return 1
    except Exception:
        reply({'error': 'Checkpoint coordination unavailable or busy; retry.'})
        return 1


if __name__ == '__main__':
    sys.exit(main())
