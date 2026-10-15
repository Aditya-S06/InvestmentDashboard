"""Per-ticker admission and numeric telemetry. No provider/config file loading.

Reservations precede network work under a lock. Unknown/broken responses retain
their reservation. The supervisor remains the authoritative hard wall deadline.
"""
import copy
import json
import math
import threading
import time
from contextvars import ContextVar

from desk_policy import (VERSION, SPEND_USD, MAX_ATTEMPTS, OUTPUT_TOKENS,
                         REQUEST_SECONDS, PRICE_CEILINGS, MAX_INPUT_BYTES,
                         MAX_EVIDENCE_BYTES)
from desk_process import atomic_json

NODE = ContextVar('desk_node', default='graph')
MEMORY = ContextVar('desk_memory_work', default=False)


class DeskLimitError(RuntimeError):
    pass


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None


class Runtime:
    def __init__(self, depth, deadline, path=None, settings=None):
        self.depth, self.deadline, self.path = depth, deadline, path
        self.settings = settings or {}
        self.lock = threading.RLock()
        self.attempts, self.tools = [], []
        self.spent = self.reserved = 0.
        self.stopped = None
        self.cache, self.evidence = {}, {}
        self.memory_deadline = None
        self.publish()

    def remaining(self):
        return self.deadline - time.time()

    def check(self):
        if self.stopped:
            raise DeskLimitError(self.stopped)
        if self.remaining() <= 0:
            self.stop('Desk ticker deadline reached')

    def stop(self, reason):
        with self.lock:
            self.stopped = reason
            self.publish()
        raise DeskLimitError(reason)

    def summary(self):
        return {'policy_version': VERSION, 'budget_usd': SPEND_USD[self.depth],
                'spent_usd': round(self.spent, 8), 'reserved_usd': round(self.reserved, 8),
                'attempts': copy.deepcopy(self.attempts), 'tools': copy.deepcopy(self.tools),
                'stop_reason': self.stopped}

    def publish(self):
        if self.path:
            atomic_json(self.path, {'run_settings': self.settings, 'desk_usage': self.summary()})

    def admit(self, payload, tier):
        # Requests are in-memory only. Persist no payload, headers or raw errors.
        size = len(json.dumps(payload, ensure_ascii=False, default=str).encode('utf-8'))
        price_in, price_out = PRICE_CEILINGS[tier]
        reservation = ((size + 1024) * price_in + OUTPUT_TOKENS[tier] * price_out) / 1_000_000
        with self.lock:
            self.check()
            if tier == 'memory' and (self.memory_deadline is None or time.monotonic() >= self.memory_deadline):
                raise DeskLimitError('Memory work deferred')
            if size > MAX_INPUT_BYTES:
                self.stop('Desk input budget reached; reduce evidence or analyst depth')
            if len(self.attempts) >= MAX_ATTEMPTS[self.depth] or self.spent + self.reserved + reservation > SPEND_USD[self.depth]:
                self.stop('Desk cost or attempt budget reached')
            row = {'tier': tier, 'node': NODE.get(), 'status': 'pending',
                   'reserved_usd': reservation, 'elapsed_ms': 0,
                   'input_tokens': 0, 'output_tokens': 0, 'reasoning_tokens': 0,
                   'cached_tokens': 0, 'cost_usd': None}
            self.attempts.append(row)
            self.reserved += reservation
            self.publish()  # durable reservation before sending
            return len(self.attempts) - 1

    def finish(self, index, status, elapsed, usage=None):
        with self.lock:
            row = self.attempts[index]
            row.update(status=status, elapsed_ms=round(elapsed * 1000))
            usage = usage if isinstance(usage, dict) else {}
            cost = number(usage.get('cost'))
            for source, target in [('prompt_tokens', 'input_tokens'), ('completion_tokens', 'output_tokens')]:
                row[target] = number(usage.get(source)) or 0
            for source, detail, target in [('completion_tokens_details', 'reasoning_tokens', 'reasoning_tokens'),
                                           ('prompt_tokens_details', 'cached_tokens', 'cached_tokens')]:
                details = usage.get(source)
                row[target] = number(details.get(detail)) or 0 if isinstance(details, dict) else 0
            if cost is not None:
                self.reserved -= row['reserved_usd']
                self.spent += cost
                row['cost_usd'] = cost
            # Unknown billing, including network errors, retains the reservation.
            if self.spent + self.reserved > SPEND_USD[self.depth]:
                self.stopped = 'Desk cost budget reached'
            self.publish()

    def tool(self, name, func, args, kwargs):
        key = (name, json.dumps([args, kwargs], sort_keys=True, default=str))
        # Serialize identical calls only; unrelated analysts continue in parallel.
        with self.lock:
            self.check()
            slot = self.cache.setdefault(key, {'lock': threading.Lock()})
        with slot['lock']:
            start = time.monotonic()
            cached = 'value' in slot
            row = {'name': name, 'node': NODE.get(), 'cached': cached, 'status': 'pending', 'elapsed_ms': 0}
            with self.lock:
                if len(self.tools) >= 160:
                    self.stop('Desk tool call budget reached')
                self.tools.append(row)
                self.publish()
            try:
                self.check()
                value = copy.deepcopy(slot['value']) if cached else func(*args, **kwargs)
                # Refuse oversized evidence explicitly, never silently cut tables.
                size = len(json.dumps(value, ensure_ascii=False, default=str).encode('utf-8'))
                with self.lock:
                    owner = NODE.get()
                    total = self.evidence.get(owner, 0) + size
                    if total > MAX_EVIDENCE_BYTES:
                        value = 'DATA_UNAVAILABLE: Desk evidence budget reached; report this data gap.'
                    else:
                        self.evidence[owner] = total
                    if not cached:
                        slot['value'] = copy.deepcopy(value)
                    row['status'] = 'done'
                return value
            except Exception:
                row['status'] = 'failed'
                raise
            finally:
                with self.lock:
                    row['elapsed_ms'] = round((time.monotonic() - start) * 1000)
                    self.publish()


def transport(runtime, tier, inner=None):
    """OpenRouter JSON transport with bounded, individually metered attempts."""
    import httpx

    class BudgetTransport(httpx.BaseTransport):
        def __init__(self):
            self.inner = inner or httpx.HTTPTransport(retries=0)

        def handle_request(self, request):
            selected = 'memory' if MEMORY.get() else tier
            payload = json.loads(request.content)
            if payload.get('stream'):
                raise DeskLimitError('Desk requires accounted non-streaming model responses')
            payload['max_tokens'] = OUTPUT_TOKENS[selected]
            payload.pop('max_completion_tokens', None)
            # Low cost, explicitly bounded reasoning; OR maps across providers.
            payload['reasoning'] = {'effort': 'low' if selected != 'deep' else 'medium'}
            payload['provider'] = {'require_parameters': True, 'max_price': {
                'prompt': PRICE_CEILINGS[selected][0], 'completion': PRICE_CEILINGS[selected][1]}}
            for attempt in range(2):
                index = runtime.admit(payload, selected)
                start = time.monotonic()
                seconds = min(REQUEST_SECONDS[selected], runtime.remaining())
                if selected == 'memory':
                    seconds = min(seconds, max(.1, runtime.memory_deadline - time.monotonic()))
                headers = dict(request.headers)
                headers.pop('content-length', None)
                bounded = httpx.Request(request.method, request.url, headers=headers,
                    json=payload, extensions={**request.extensions, 'timeout': dict(connect=min(10., seconds),
                        read=seconds, write=seconds, pool=seconds)})
                try:
                    response = self.inner.handle_request(bounded)
                    response.read()
                    try:
                        body = response.json()
                    except (ValueError, UnicodeError):
                        body = {}
                    usage = body.get('usage') if isinstance(body, dict) else None
                    status = 'done' if response.is_success else f'http_{response.status_code}'
                    runtime.finish(index, status, time.monotonic() - start, usage)
                    choices = body.get('choices', []) if isinstance(body, dict) else []
                    if any(c.get('finish_reason') == 'length' for c in choices):
                        runtime.stop('Desk model output was truncated; report requires review')
                    if response.status_code not in (429, 500, 502, 503, 504) or attempt or selected == 'memory':
                        return response
                    response.close()
                except httpx.TransportError:
                    runtime.finish(index, 'network_error', time.monotonic() - start)
                    if attempt or selected == 'memory':
                        raise
                # Reserve a useful full attempt, not an almost-expired retry.
                if runtime.remaining() < REQUEST_SECONDS[selected] + 1:
                    runtime.stop('Desk has insufficient time for a provider retry')
                time.sleep(1)
            raise DeskLimitError('Desk retry budget reached')

        def close(self):
            self.inner.close()

    return BudgetTransport()
