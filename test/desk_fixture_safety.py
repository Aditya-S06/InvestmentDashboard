"""Offline real-tool/emitter/memory fixture; only isolated caller-owned paths."""
from contextlib import ExitStack, redirect_stderr
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'TradingAgents'))
FRED_KEY = 'desk14-fred-sentinel-NOT-A-REAL-KEY'
UNICODE = 'café 東京 信号 🚀'


def guard():
    def audit(event, args):
        if event in ('socket.connect', 'socket.getaddrinfo'):
            raise AssertionError('Live network forbidden in Desk safety fixture')
        if event == 'open' and isinstance(args[0], (str, bytes)):
            name = Path(os.fsdecode(args[0])).name
            if name == '.env' or name.startswith('.env.'):
                raise AssertionError('Dotenv read forbidden in Desk safety fixture')
    sys.addaudithook(audit)


def fixture_env():
    # Deliberately narrower than runtime_env: no inherited keys/proxy credentials.
    names = ('PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE')
    return {k: v for k, v in os.environ.items() if k.upper() in names} | {
        'PYTHON_DOTENV_DISABLED': '1', 'PYTHONDONTWRITEBYTECODE': '1',
        'OPENROUTER_API_KEY': 'desk14-router-sentinel', 'FRED_API_KEY': FRED_KEY,
        'DESK_DEEP_MODEL': 'offline', 'DESK_QUICK_MODEL': 'offline',
    }


def macro_probe(directory):
    """Real app graph + news analyst + ToolNode + SQLite, only HTTP/LLM mocked."""
    import trading_desk_runner as runner
    from langchain_core.callbacks import BaseCallbackHandler
    from langchain_core.messages import AIMessage, ToolMessage
    from langchain_core.runnables import RunnableLambda
    from tradingagents.graph.checkpointer import get_checkpointer
    from tradingagents.graph import trading_graph
    from types import SimpleNamespace
    import requests

    calls, prompts, tool_outputs = [], [], []

    def http503(url, *, params, timeout):
        calls.append((url, timeout))
        response = requests.Response()
        response.status_code = 503
        response.reason = 'Service Unavailable'
        response.url = requests.Request('GET', url, params=params).prepare().url
        response._content = b'offline HTTP failure'
        return response

    class Model:
        def bind_tools(self, tools):
            def invoke(prompt):
                messages = prompt.to_messages()
                prompts.append([m.model_dump() for m in messages])
                results = [m for m in messages if isinstance(m, ToolMessage)]
                if results:
                    return AIMessage(content=UNICODE + '\n' + results[-1].content)
                return AIMessage(content='', tool_calls=[{
                    'name': 'get_macro_indicators', 'id': 'macro-call',
                    'args': {'indicator': 'cpi', 'curr_date': '2026-10-01'},
                }])
            return RunnableLambda(invoke)

    class Observer(BaseCallbackHandler):
        def on_tool_end(self, output, **kwargs):
            tool_outputs.append(output.model_dump() if hasattr(output, 'model_dump') else output)

    directory.mkdir(parents=True, exist_ok=True)
    config = runner.build_config('fast', True, directory / 'results', directory / 'memory.md', directory / 'cache')
    event_stream, logs = io.StringIO(), io.StringIO()
    with ExitStack() as stack:
        stack.enter_context(patch.object(trading_graph, 'create_llm_client',
                                        return_value=SimpleNamespace(get_llm=lambda: Model())))
        stack.enter_context(patch('tradingagents.dataflows.fred.requests.get', side_effect=http503))
        stack.enter_context(patch.object(runner, '_EVENT_STREAM', event_stream))
        stack.enter_context(redirect_stderr(runner._RedactingWriter(logs)))
        graph = runner.TradingAgentsGraph(selected_analysts=['news'], config=config)
        direct = graph.tool_nodes['news'].tools_by_name['get_macro_indicators'].invoke(
            {'indicator': 'cpi', 'curr_date': '2026-10-01'})
        with get_checkpointer(directory / 'cache', 'AAPL') as saver:
            compiled = graph.workflow.compile(checkpointer=saver, interrupt_before=['Msg Clear News'])
            state = compiled.invoke(graph.propagator.create_initial_state('AAPL', '2026-10-01'), {
                'configurable': {'thread_id': 'offline-macro'},
                'callbacks': [runner.DeskEventHandler('AAPL'), Observer()],
            })
            checkpoints = [repr(item) for item in saver.list(None)]
        payload = {'signal': 'REVIEW', 'finalState': runner.serializable_final_state(state)}
        runner.atomic_json(directory / 'out-AAPL.json', payload)
        runner.emit({'event': 'error', 'message': UNICODE + ' ' + FRED_KEY})
    evidence = {'direct': direct, 'prompts': prompts, 'toolOutputs': tool_outputs,
                'checkpoints': checkpoints, 'events': event_stream.getvalue(),
                'calls': calls, 'logs': logs.getvalue(), 'memoryType': type(graph.memory_log).__name__}
    # Write evidence without the application's redactor so assertions cannot be
    # satisfied by sanitizing only the test's copy of unsafe in-graph state.
    (directory / 'evidence.json').write_text(json.dumps(evidence, ensure_ascii=False), encoding='utf-8')
    return evidence


def emitter():
    assert sys.stdout.encoding.lower() == 'cp1252'
    import trading_desk_runner as runner
    runner.emit({'event': 'memo', 'text': UNICODE + ' ' + FRED_KEY})
    # Exercise the actual main error path after stdout has moved to stderr.
    result = runner._main(['--ticker', 'AAPL', '--as-of', UNICODE + FRED_KEY,
                          '--results-dir', '.', '--out', 'unused.json'])
    assert result == 1


def stream_probe(directory):
    from desk_supervisor import pump
    directory.mkdir(parents=True, exist_ok=True)
    child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'emitter'],
                             cwd=directory, env=fixture_env() | {'PYTHONIOENCODING': 'cp1252:strict', 'PYTHONUTF8': '0'},
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    errors = []
    threads = [threading.Thread(target=pump, args=(stream, directory / name, errors))
               for stream, name in ((child.stdout, 'events.jsonl'), (child.stderr, 'stderr.log'))]
    try:
        for thread in threads:
            thread.start()
        assert child.wait(timeout=40) == 0
    finally:
        if child.poll() is None:
            child.kill()
        child.wait(timeout=10)
        for thread in threads:
            thread.join(timeout=5)
            assert not thread.is_alive()
    assert errors == ['Desk graph reported an error']


def graph_worker(path, ticker):
    import trading_desk_runner as runner
    from desk_process import Lock
    from tradingagents.graph import trading_graph
    from types import SimpleNamespace
    config = runner.build_config('fast', False, path.parent / ticker, path, path.parent / 'cache')
    with patch.object(trading_graph, 'create_llm_client',
                      return_value=SimpleNamespace(get_llm=lambda: None)):
        graph = runner.TradingAgentsGraph(selected_analysts=['news'], config=config)
    graph.resolve_instrument_context = lambda *args: 'offline instrument'
    graph.process_signal = lambda *args: 'Hold'

    def invoke(state, **kwargs):
        # A peer may be finishing its short initial read; wait for that, but a
        # lock incorrectly held by this graph itself would time out here.
        with Lock(path.with_name(path.name + '.lock')):
            pass
        print(json.dumps({'provider': ticker, 'memoryUnlocked': True}), flush=True)
        assert json.loads(sys.stdin.readline()) == {'release': True}
        return state | {'final_trade_decision': 'FINAL TRANSACTION PROPOSAL: **HOLD**',
                        'investment_plan': UNICODE, 'trader_investment_plan': UNICODE}
    graph.graph = SimpleNamespace(invoke=invoke)
    print(json.dumps({'ready': True}), flush=True)
    assert json.loads(sys.stdin.readline()) == {'op': 'run'}
    graph.propagate(ticker, '2026-10-01')
    print(json.dumps({'done': True}), flush=True)


def memory_worker(path):
    import dotenv
    dotenv.load_dotenv = lambda *a, **kw: False
    from desk_memory import DeskMemoryLog
    from desk_process import Lock
    memory = DeskMemoryLog({'memory_log_path': str(path)})
    original_read = Path.read_text

    def reply(value):
        print(json.dumps(value), flush=True)

    reply({'ready': True})
    for line in sys.stdin:
        command = json.loads(line)
        if command['op'] == 'exit':
            return
        if command.get('probe'):
            try:
                with Lock(path.with_name(path.name + '.lock'), wait=0):
                    reply({'blocked': False})
            except TimeoutError:
                reply({'blocked': True})

        def read(file, *args, **kwargs):
            value = original_read(file, *args, **kwargs)
            if file == path and command.get('hold'):
                reply({'read': True})
                assert json.loads(sys.stdin.readline()) == {'release': True}
            return value

        try:
            with patch.object(Path, 'read_text', read):
                ticker = command.get('ticker', 'AAPL')
                values = dict(ticker=ticker, trade_date='2026-10-01', raw_return=.1,
                              alpha_return=.02, holding_days=5, reflection=UNICODE,
                              resolution_date='2026-10-06')
                if command['op'] == 'append':
                    memory.store_decision(ticker, '2026-10-01', 'FINAL TRANSACTION PROPOSAL: **BUY**')
                elif command['op'] == 'update':
                    memory.update_with_outcome(**values)
                elif command['op'] == 'batch':
                    memory.batch_update_with_outcomes([values])
                elif command['op'] == 'error':
                    with patch.object(memory, '_apply_rotation', side_effect=ValueError('fixture failure')):
                        memory.update_with_outcome(**values)
                elif command['op'] == 'read':
                    reply({'entries': memory.load_entries()})
            reply({'done': True})
        except ValueError as exc:
            reply({'error': str(exc)})


if __name__ == '__main__':
    guard()
    with patch.dict(os.environ, fixture_env(), clear=True):
        mode = sys.argv[1]
        if mode == 'macro':
            macro_probe(Path(sys.argv[2]))
        elif mode == 'boundaries':
            macro_probe(Path(sys.argv[2]))
            stream_probe(Path(sys.argv[2]))
        elif mode == 'emitter':
            emitter()
        elif mode == 'memory':
            memory_worker(Path(sys.argv[2]))
        elif mode == 'graph':
            graph_worker(Path(sys.argv[2]), sys.argv[3])
