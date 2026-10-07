"""Gate graph execution until containment is established; parent pipe is a lease.

Windows: the supervisor's kill-on-close Job owns this process and descendants.
POSIX: this process is a session leader; EOF kills its own process group, so
neither recovery nor cancellation ever sends a signal to a recorded numeric PID.
"""
import os
import signal
import subprocess
import sys
import threading
from desk_process import atomic_json, graph_env


def stop():
    if os.name != 'nt':
        os.killpg(os.getpgrp(), signal.SIGKILL)
    os._exit(125)


def watch(stream):
    stream.read()  # stop command or EOF both revoke the lease
    stop()


if __name__ == '__main__':
    lease = sys.stdin.buffer
    if lease.readline() != b'start\n':
        stop()
    threading.Thread(target=watch, args=(lease,), daemon=True).start()
    sys.stdin = open(os.devnull)
    exit_file = sys.argv[1]
    code = 0
    try:
        # Keep the lease guardian separate from provider code: os._exit or a
        # native crash in the graph must not disable POSIX descendant cleanup.
        child = subprocess.Popen([sys.executable, *sys.argv[2:]], env=graph_env(),
                                 stdin=subprocess.DEVNULL,
                                 creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        code = child.wait()
    except BaseException:
        code = 1
    sys.stdout.flush()
    sys.stderr.flush()
    atomic_json(exit_file, {'code': code})
    # Keep the session leader alive until the supervisor closes its lease.
    # It then kills its own group, including descendants left by a returned graph.
    threading.Event().wait()
