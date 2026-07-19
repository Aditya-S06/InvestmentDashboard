"""In-process TTL cache + token-bucket rate limit for YouTube Data API calls."""
from __future__ import annotations

import os
import threading
import time
from typing import Any, Callable, Optional, TypeVar

T = TypeVar("T")

_lock = threading.Lock()
_cache: dict[str, tuple[float, Any]] = {}
_tokens: float = float(os.environ.get("YOUTUBE_RATE_LIMIT_PER_MIN", "30"))
_max_tokens: float = _tokens
_last_refill: float = time.monotonic()

CHANNEL_TTL_SEC = 3600.0  # channel id resolution
VIDEO_LIST_TTL_SEC = 300.0  # recent video lists


def _refill_locked() -> None:
    global _tokens, _last_refill
    now = time.monotonic()
    elapsed = now - _last_refill
    if elapsed <= 0:
        return
    rate = _max_tokens / 60.0
    _tokens = min(_max_tokens, _tokens + elapsed * rate)
    _last_refill = now


def acquire_token(cost: float = 1.0) -> bool:
    """Return True if a call is allowed under the per-minute budget."""
    global _tokens
    with _lock:
        _refill_locked()
        if _tokens >= cost:
            _tokens -= cost
            return True
        return False


def wait_for_token(cost: float = 1.0, max_wait_sec: float = 65.0) -> None:
    """Block until a rate-limit token is available (or raise)."""
    deadline = time.monotonic() + max_wait_sec
    while time.monotonic() < deadline:
        if acquire_token(cost):
            return
        time.sleep(0.5)
    raise RuntimeError("youtube_rate_limited")


def cache_get(key: str) -> Optional[Any]:
    with _lock:
        entry = _cache.get(key)
        if not entry:
            return None
        expires_at, value = entry
        if time.monotonic() > expires_at:
            del _cache[key]
            return None
        return value


def cache_set(key: str, value: Any, ttl_sec: float) -> None:
    with _lock:
        _cache[key] = (time.monotonic() + ttl_sec, value)


def cached_call(key: str, ttl_sec: float, fn: Callable[[], T]) -> T:
    """Return cached value or call fn (consuming one rate-limit token)."""
    hit = cache_get(key)
    if hit is not None:
        return hit
    wait_for_token()
    value = fn()
    cache_set(key, value, ttl_sec)
    return value


def clear_cache() -> None:
    with _lock:
        _cache.clear()
