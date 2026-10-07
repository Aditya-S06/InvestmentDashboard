"""Offline graph substitute, used only by lifecycle tests. Never imports providers."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import socket

# Fixture processes fail closed even if a future edit accidentally imports a provider.
def offline(*args, **kwargs):
    raise AssertionError('Network forbidden in Desk fixture')
socket.socket.connect = offline

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from desk_process import atomic_json
from subprocess_env import runtime_env

parser = argparse.ArgumentParser()
for name in ('ticker', 'as-of', 'depth', 'analysts', 'asset-type', 'checkpoint', 'out', 'results-dir', 'memory-log-path', 'data-cache-dir'):
    parser.add_argument('--' + name, required=True)
args = parser.parse_args()
directory = Path(args.results_dir)
mode = json.loads((directory / 'fixture.json').read_text())[args.ticker]
wait = mode.startswith('wait:')
if wait:
    mode = mode.split(':', 1)[1]
atomic_json(directory / f'seen-{args.ticker}.json', dict(envNames=sorted(os.environ), args=vars(args)))
for key in ('OPENROUTER_API_KEY', 'FRED_API_KEY', 'HTTPS_PROXY'):
    value = os.environ.get(key, '')
    # Deliberately split writes across the secret; supervisor buffers whole lines.
    sys.stderr.write(value[:4]); sys.stderr.flush()
    sys.stderr.write(value[4:] + '\n'); sys.stderr.flush()
print(json.dumps({'event': 'phase', 'phase': 'analysts', 'ticker': args.ticker}), flush=True)
print(json.dumps({'event': 'agent', 'agent': 'market', 'status': 'start'}), flush=True)
# Split a UTF-8 memo across writes and include malformed/unfinished records.
memo = (json.dumps({'event': 'memo', 'agent': 'market', 'text': args.ticker + ' café distinct memo'}, ensure_ascii=False) + '\n').encode('utf-8')
split = memo.index('é'.encode('utf-8')) + 1
sys.stdout.buffer.write(memo[:split]); sys.stdout.buffer.flush()
sys.stdout.buffer.write(memo[split:]); sys.stdout.buffer.flush()
if mode in ('stall', 'wait') or wait:
    heartbeat = directory / f'heartbeat-{args.ticker}'
    subprocess.Popen([sys.executable, '-c',
                      'import pathlib,sys,time\np=pathlib.Path(sys.argv[1])\nwhile True:\n p.write_text(str(time.time()))\n time.sleep(.05)',
                      str(heartbeat)], env=runtime_env(), stdin=subprocess.DEVNULL,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    while mode == 'stall' or not (directory / f'release-{args.ticker}').exists():
        time.sleep(.03)
if mode == 'crash':
    os._exit(2)
if mode == 'missing':
    sys.exit(0)
if mode == 'corrupt':
    Path(args.out).write_text('{broken')
    sys.stdout.write('{"event":"memo","text":"unfinished'); sys.stdout.flush()
    sys.exit(0)
if mode == 'error':
    print(json.dumps({'event': 'error', 'message': 'fixture error'}), flush=True)
rating = 'Sell' if args.ticker == 'MSFT' else 'unknown' if mode == 'review' else 'Buy'
atomic_json(args.out, {'signal': rating, 'finalState': {
    'company_of_interest': args.ticker, 'trade_date': args.as_of,
    'market_report': args.ticker + ' distinct memo ' + os.environ.get('FRED_API_KEY', ''),
    'final_trade_decision': '**Investment thesis**: ' + args.ticker + ' fixture thesis',
    'apiKey': 'FORBIDDEN_FIELD', 'messages': ['FORBIDDEN_MESSAGES'],
}})
print('{malformed complete record}', flush=True)
print(json.dumps({'event': 'agent', 'agent': 'market', 'status': 'done'}), flush=True)
print(json.dumps({'event': 'done', 'ticker': args.ticker}), flush=True)
