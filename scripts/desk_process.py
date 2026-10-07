"""Stdlib-only Desk process boundary. No dotenv, DB, provider or broker imports."""
import ctypes
import json
import os
from pathlib import Path
import time
from urllib.parse import parse_qsl, quote, unquote, urlsplit
import uuid

from subprocess_env import runtime_env

DESK_ENV_KEYS = (
    'OPENROUTER_API_KEY', 'OPENROUTER_BASE_URL', 'DESK_DEEP_MODEL', 'DESK_QUICK_MODEL',
    'TRADINGAGENTS_OUTPUT_LANGUAGE', 'TRADINGAGENTS_BENCHMARK_TICKER',
    'TRADINGAGENTS_TEMPERATURE', 'TRADINGAGENTS_LLM_MAX_RETRIES', 'TRADINGAGENTS_MAX_TOKENS',
    'FRED_API_KEY', 'PYTHONPATH', 'TRADINGAGENTS_RESULTS_DIR', 'TRADINGAGENTS_CACHE_DIR',
    'TRADINGAGENTS_MEMORY_LOG_PATH', 'TRADINGAGENTS_CHECKPOINT_ENABLED',
)


def graph_env(source=None):
    source = os.environ if source is None else source
    return {**runtime_env(source), **{k: source[k] for k in DESK_ENV_KEYS if k in source}}


def redact(text):
    values = []
    for key, value in os.environ.items():
        if key.upper() in ('OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'FRED_API_KEY'):
            values.append(value)
        if key.upper() in ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'OPENROUTER_BASE_URL'):
            values.append(value)
            try:
                url = urlsplit(value)
                if url.username or url.password:
                    values.extend([value, url.username, url.password,
                                   unquote(url.username or ''), unquote(url.password or '')])
                values.extend(v for _, v in parse_qsl(url.query))
            except ValueError:
                values.append(value)
    variants = {v for value in values if value for v in
                (value, quote(value, safe=''), json.dumps(value, ensure_ascii=False)[1:-1],
                 json.dumps(value, ensure_ascii=True)[1:-1])}
    for value in sorted(variants, key=len, reverse=True):
        text = text.replace(value, '[REDACTED]')
    return text


def safe_path(path):
    path = Path(path).absolute()
    if any(p.is_symlink() or (hasattr(p, 'is_junction') and p.is_junction())
           for p in (path, *path.parents)):
        raise ValueError('Linked Desk artifacts are not supported')
    return path


def atomic_json(path, value):
    path = safe_path(path)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temp.open('x', encoding='utf-8') as stream:
            stream.write(redact(json.dumps(value, ensure_ascii=False)))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


class Lock:
    """Never unlink lock files: all processes must lock the same inode/byte."""
    def __init__(self, path, wait=5):
        self.path, self.wait, self.file = safe_path(path), wait, None

    def __enter__(self):
        self.file = self.path.open('a+b')
        if self.path.stat().st_size == 0:
            self.file.write(b'0')
            self.file.flush()
        until = time.monotonic() + self.wait
        while True:
            try:
                self.file.seek(0)
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except OSError:
                if time.monotonic() >= until:
                    self.file.close()
                    self.file = None
                    raise TimeoutError('Desk control lock busy') from None
                time.sleep(.02)

    def __exit__(self, *_):
        if self.file:
            if os.name == 'nt':
                import msvcrt
                self.file.seek(0)
                msvcrt.locking(self.file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_UN)
            self.file.close()


class WindowsJob:
    """A stable kernel handle, never a pid lookup. Close kills all descendants."""
    def __init__(self):
        self.handle = None
        if os.name != 'nt':
            return
        from ctypes import wintypes as w
        class Basic(ctypes.Structure):
            _fields_ = [('ProcessTime', ctypes.c_int64), ('JobTime', ctypes.c_int64),
                        ('Flags', w.DWORD), ('Min', ctypes.c_size_t), ('Max', ctypes.c_size_t),
                        ('Count', w.DWORD), ('Affinity', ctypes.c_size_t),
                        ('Priority', w.DWORD), ('Scheduling', w.DWORD)]
        class IO(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in ('r', 'w', 'o', 'rb', 'wb', 'ob')]
        class Extended(ctypes.Structure):
            _fields_ = [('Basic', Basic), ('IO', IO), ('ProcessMemory', ctypes.c_size_t),
                        ('JobMemory', ctypes.c_size_t), ('PeakProcess', ctypes.c_size_t),
                        ('PeakJob', ctypes.c_size_t)]
        self.api = ctypes.WinDLL('kernel32', use_last_error=True)
        self.api.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
        self.api.CreateJobObjectW.restype = w.HANDLE
        self.api.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
        self.api.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
        self.api.CloseHandle.argtypes = [w.HANDLE]
        self.handle = self.api.CreateJobObjectW(None, None)
        info = Extended()
        info.Basic.Flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; no breakaway
        if not self.handle or not self.api.SetInformationJobObject(self.handle, 9, ctypes.byref(info), ctypes.sizeof(info)):
            self.close()
            raise OSError('Cannot establish Desk job containment')

    def assign(self, child):
        if self.handle and not self.api.AssignProcessToJobObject(self.handle, int(child._handle)):
            raise OSError('Cannot assign Desk graph to owned job')

    def close(self):
        if self.handle:
            self.api.CloseHandle(self.handle)
            self.handle = None
