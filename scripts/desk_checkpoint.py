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
CONFIG_FIELDS = ('desk_policy_version', 'max_tool_rounds', 'deep_think_llm', 'quick_think_llm', 'output_language',
                 'benchmark_ticker', 'temperature', 'llm_max_retries', 'max_tokens')

# Pinned upstream identity for every sidecar written by this module.
UPSTREAM_VERSION = '0.6.0'
UPSTREAM_SHA = '1394a3f72aa4393e1a98f51b382434c4b4c2d972'
UPSTREAM_TOPOLOGY = ('analysts=parallel', 'memory=parallel')
DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'


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
    import tradingagents
    if getattr(tradingagents, '__version__', None) != UPSTREAM_VERSION:
        raise RuntimeError(
            f'Desk checkpoint adapter pins tradingagents {UPSTREAM_VERSION}, '
            f'found {getattr(tradingagents, "__version__", None)!r}')
    from tradingagents.graph.trading_graph import TradingAgentsGraph
    from tradingagents.graph.checkpointer import thread_id
    return TradingAgentsGraph, thread_id


def backend_url_for(environ):
    return (environ.get('OPENROUTER_BASE_URL', '').strip()
            or DEFAULT_OPENROUTER_BASE_URL)


def effective_config(value, graph_settings, backend_url, checkpoint=True):
    """The exact config dict execution would use, for signature purposes.

    One builder for execution-time recording and keyless restore validation:
    DEFAULT_CONFIG plus the runner's fixed OpenRouter choices, depth rounds,
    the validated non-secret model settings, and path/checkpoint flags (the
    signature ignores paths, checkpointing and retry counts). Never includes
    credentials: only ``backend_url`` (an endpoint, also allowlisted by
    upstream's own ``run_settings``) travels with it, and it is never persisted.
    """
    from tradingagents.default_config import DEFAULT_CONFIG
    config = dict(DEFAULT_CONFIG)
    from desk_policy import config_policy
    config.update(config_policy(value['depth']))
    config.update({
        'llm_provider': 'openrouter',
        'backend_url': backend_url,
        'max_debate_rounds': ROUNDS[value['depth']],
        'max_risk_discuss_rounds': ROUNDS[value['depth']],
        'checkpoint_enabled': bool(checkpoint),
    })
    config.update(graph_settings)
    return config


def compute_thread_id(value, graph_settings, backend_url):
    """Opaque resume thread for validated settings via the pinned implementation.

    Calls upstream ``_run_signature`` unbound on the effective config: no
    copied hash algorithm, and every effective setting (models, endpoints,
    vendors, limits) participates. Paths and retry counts are excluded by
    upstream itself.
    """
    graph_type, thread_id = upstream()
    value = settings(value)
    namespace = SimpleNamespace(
        selected_analysts=tuple(value['analysts']),
        config=effective_config(value, graph_settings, backend_url))
    signature = graph_type._run_signature(namespace, value['assetType'])
    return thread_id(value['ticker'], value['asOf'], signature)


def identity(value):
    raise RuntimeError(
        'identity() was replaced by compute_thread_id(); pass explicit '
        'graph settings and backend URL so listing and execution agree')


def inspection_workflow(value):
    graph_type, _ = upstream()
    from tradingagents.default_config import DEFAULT_CONFIG
    from tradingagents.graph.setup import GraphSetup
    from tradingagents.graph.conditional_logic import ConditionalLogic
    # Upstream factories capture LLMs in node closures. get_state never invokes
    # nodes, so inspection needs neither provider clients nor credentials.
    # Memory runs as a no-op: listing must see the same Memory Log topology as
    # execution without settling anything or touching the log.
    rounds = ROUNDS[value['depth']]
    setup = GraphSetup(None, None, ConditionalLogic(rounds, rounds),
                       DEFAULT_CONFIG['max_tool_rounds'])
    return setup.setup_graph(value['analysts'],
                             memory_node=lambda state: {'past_context': '', 'memory_note': ''})


def directory_settings_path(user, ticker):
    directory, _ = paths(user, ticker)
    return safe_path(directory / f'{ticker}.settings.json')


def sidecars(user, ticker):
    """All persisted checkpoint sidecars for a ticker: {threadId: entry}."""
    try:
        saved = read(directory_settings_path(user, ticker))
    except FileNotFoundError:
        return {}
    return saved if isinstance(saved, dict) else {}


def _entry_settings(entry):
    return settings({k: entry[k] for k in ('ticker', 'asOf', 'depth', 'assetType', 'analysts')})


def _current_version(entry):
    upstream = entry.get('upstream') if isinstance(entry, dict) else None
    return (isinstance(upstream, dict) and upstream.get('version') == UPSTREAM_VERSION
            and upstream.get('sha') == UPSTREAM_SHA)


def _inspect_thread(db, value, tid):
    import sqlite3

    from langgraph.checkpoint.sqlite import SqliteSaver
    # Read-only connection: listing cannot create schema/rows or repair corruption.
    with closing(sqlite3.connect(db.as_uri() + '?mode=ro', uri=True, check_same_thread=False)) as connection:
        saver = SqliteSaver(connection)
        saver.is_setup = True  # schema belongs exclusively to upstream's writer
        config = {'configurable': {'thread_id': tid}}
        try:
            cp = saver.get_tuple(config)
        except sqlite3.OperationalError:
            # Fresh/empty database without checkpoint tables: no state, not corruption.
            return None
        if cp is None or cp.metadata.get('step') is None:
            return None
        snapshot = inspection_workflow(value).compile(checkpointer=saver).get_state(config)
        if not snapshot.next:
            return None
        return dict(**value, threadId=tid, checkpointId=cp.checkpoint['id'], step=cp.metadata['step'])


def inspect_saved(user, value, thread_id=None):
    """Unfinished thread state for validated settings, or None.

    With an explicit thread_id, inspects exactly that thread. Without one
    (the launch-time resumable check), inspects each matching current-version
    sidecar and returns the first unfinished thread. Keyless: endpoint
    differences fail closed by skipping non-reproducible candidates.
    """
    value = settings(value)
    _, db = paths(user, value['ticker'])
    if not db.is_file():
        return None
    if thread_id is None:
        candidates = []
        for tid, entry in sidecars(user, value['ticker']).items():
            if not isinstance(entry, dict) or not _current_version(entry):
                continue
            try:
                if _entry_settings(entry) != value:
                    continue
                graph_settings(entry)
                if compute_thread_id(value, entry['graphSettings'], DEFAULT_OPENROUTER_BASE_URL) != tid:
                    continue
            except (ValueError, KeyError, TypeError):
                continue
            candidates.append(tid)
    else:
        candidates = [thread_id]
    for tid in candidates:
        found = _inspect_thread(db, value, tid)
        if found:
            return found
    return None


def remember(user, value, config, backend_url):
    value = settings(value)
    graph_settings_value = {k: config.get(k) for k in CONFIG_FIELDS}
    graph_settings({'graphSettings': graph_settings_value})
    tid = compute_thread_id(value, graph_settings_value, backend_url)
    saved = sidecars(user, value['ticker'])
    # Persist only these explicit non-secret choices plus version/topology
    # markers. No URLs, keys, or full configuration are ever serialized.
    saved[tid] = {**value, 'graphSettings': graph_settings_value, 'upstream': {
        'version': UPSTREAM_VERSION, 'sha': UPSTREAM_SHA, 'topology': list(UPSTREAM_TOPOLOGY)}}
    atomic_json(directory_settings_path(user, value['ticker']), saved)


def graph_settings(saved):
    from desk_policy import VERSION
    if saved.get('graphSettings', {}).get('desk_policy_version') != VERSION:
        raise ValueError('Checkpoint uses an older Desk budget policy; start a fresh run.')
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
            saved = sidecars(user, ticker) if db.exists() else {}
            for tid, entry in saved.items():
                if not isinstance(entry, dict) or entry.get('ticker') != ticker:
                    raise ValueError('Mismatched metadata')
                if not _current_version(entry):
                    # Explicit incompatible-version reason, never a silent empty.
                    seen = (entry.get('upstream') or {}).get('version', 'pre-0.6') \
                        if isinstance(entry.get('upstream'), dict) else 'pre-0.6'
                    item['reason'] = (
                        f'Checkpoint saved under TradingAgents {seen}; resume requires '
                        f'the v{UPSTREAM_VERSION} epoch. Clear it or finish it on the old pin.')
                    continue
                value = _entry_settings(entry)
                graph_settings(entry)
                if compute_thread_id(value, entry['graphSettings'], DEFAULT_OPENROUTER_BASE_URL) != tid:
                    raise ValueError('Mismatched metadata')
                found = inspect_saved(user, value, tid)
                if found:
                    item['checkpoints'].append(found)
            if db.exists() and not item['checkpoints'] and item['reason'] is None:
                item['reason'] = 'No matching unfinished state with saved settings. Completed or empty databases cannot resume.'
        except Exception:
            item['checkpoints'] = []
            item['reason'] = 'Checkpoint or saved settings are unreadable; Resume is unavailable.'
        output.append(item)
    return output


def verify_thread(value, graph_settings_value, backend_url, thread_id):
    """Fail closed unless the live effective config reproduces the reference thread.

    Called at execution time after restore: model, endpoint, vendor or limit
    drift since listing refuses the resume instead of continuing foreign state.
    """
    if compute_thread_id(value, graph_settings_value, backend_url) != thread_id:
        raise ValueError(
            'Run settings changed since the checkpoint was listed '
            '(model, endpoint, vendor or limit); resume refused.')


def restore(user, reference, requested):
    ticker = ticker_value(reference['ticker'])
    try:
        saved = sidecars(user, ticker)[reference['threadId']]
    except KeyError:
        raise CheckpointNotFound('Saved checkpoint not found') from None
    if not isinstance(saved, dict) or not _current_version(saved):
        raise ValueError(
            f'Checkpoint was saved under an older TradingAgents epoch; resume requires v{UPSTREAM_VERSION}.')
    found = inspect_saved(user, _entry_settings(saved), reference['threadId'])
    if not found or any(found[k] != reference[k] for k in ('threadId', 'checkpointId')):
        raise ValueError('Checkpoint changed or is no longer resumable; refresh saved checkpoints.')
    if settings(requested) != _entry_settings(saved):
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
