"""Create an actual pending pinned-graph SQLite checkpoint, without provider work."""
from pathlib import Path
import socket
import sys
import os
import threading

# Parent pipe is a lease during fixture work. Do not block on the Windows CRT
# stdin handle while native modules initialize (NumPy import can stall there).
lease = sys.stdin
lease_fd = lease.fileno()
sys.stdin = open(os.devnull)

def parent_lease():
    while os.read(lease_fd, 1):
        pass
    os._exit(75)

sys.stdout.reconfigure(encoding='utf-8', newline='\n')

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))

def offline(*args, **kwargs):
    raise AssertionError('Network forbidden in checkpoint fixture')
socket.socket.connect = offline

from desk_policy import config_policy
from desk_checkpoint import (
    DEFAULT_OPENROUTER_BASE_URL,
    compute_thread_id,
    inspection_workflow,
    remember,
    upstream,
)
upstream()
from tradingagents.graph.checkpointer import get_checkpointer

threading.Thread(target=parent_lease, daemon=True).start()
print('DESK_FIXTURE_READY', flush=True)
if len(sys.argv) > 2 and sys.argv[2] == 'fail-after-ready':
    import time
    sys.stderr.write('fixture-router-'); sys.stderr.flush()
    sys.stderr.write('secret' + 'x' * 262144); sys.stderr.flush()
    while True:
        time.sleep(.05)

user = Path(sys.argv[1])
value = dict(ticker='AAPL', asOf='2026-10-01', depth='fast', analysts=['market'], assetType='stock')
settings = dict(config_policy(value['depth']), deep_think_llm='fixture-deep', quick_think_llm='fixture-quick', output_language='English',
                benchmark_ticker=None, temperature=None, llm_max_retries=None, max_tokens=None)
remember(user, value, settings, DEFAULT_OPENROUTER_BASE_URL)
thread = compute_thread_id(value, settings, DEFAULT_OPENROUTER_BASE_URL)
with get_checkpointer(user / 'cache', 'AAPL') as saver:
    graph = inspection_workflow(value).compile(checkpointer=saver, interrupt_before=['Market Analyst'])
    graph.invoke({'company_of_interest': 'AAPL', 'trade_date': value['asOf'], 'asset_type': 'stock', 'messages': []},
                 {'configurable': {'thread_id': thread}})

# SQLite has closed above. Avoid interpreter shutdown waiting on the lease's
# native stdin read; the parent still observes a real successful process exit.
sys.stdout.flush()
sys.stderr.flush()
os._exit(0)
