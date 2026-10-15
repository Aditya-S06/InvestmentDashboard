"""Pinned v0.6 adapters for cost-aware clients, tool reuse and data deadlines."""
import dataclasses
import threading
import time
from types import SimpleNamespace

from desk_runtime import MEMORY, transport


def install_clients(runtime):
    import httpx
    import tradingagents.graph.trading_graph as graph_module
    from tradingagents.llm_clients.openai_client import (
        OPENAI_COMPATIBLE_PROVIDERS, DeepSeekChatOpenAI, _input_to_messages)
    from langchain_core.messages import AIMessage

    class RouterChat(DeepSeekChatOpenAI):
        # LangChain's OpenAI serializer drops OR reasoning_details. Preserve
        # opaque blocks in-memory across tool turns, never in usage telemetry.
        def _create_chat_result(self, response, generation_info=None):
            result = super()._create_chat_result(response, generation_info)
            data = response if isinstance(response, dict) else response.model_dump()
            for generation, choice in zip(result.generations, data.get('choices', [])):
                details = choice.get('message', {}).get('reasoning_details')
                if details is not None:
                    generation.message.additional_kwargs['reasoning_details'] = details
            return result

        def _get_request_payload(self, input_, *, stop=None, **kwargs):
            payload = super()._get_request_payload(input_, stop=stop, **kwargs)
            for outgoing, message in zip(payload.get('messages', []), _input_to_messages(input_)):
                if isinstance(message, AIMessage) and 'reasoning_details' in message.additional_kwargs:
                    outgoing['reasoning_details'] = message.additional_kwargs['reasoning_details']
            return payload

    original = graph_module.create_tier_client
    spec = OPENAI_COMPATIBLE_PROVIDERS['openrouter']
    clients = []
    OPENAI_COMPATIBLE_PROVIDERS['openrouter'] = dataclasses.replace(spec, chat_class=RouterChat)

    def create(config, tier, **extra):
        client = httpx.Client(transport=transport(runtime, tier))
        clients.append(client)
        return original(config, tier, **extra, http_client=client)

    graph_module.create_tier_client = create

    def restore():
        graph_module.create_tier_client = original
        OPENAI_COMPATIBLE_PROVIDERS['openrouter'] = spec
    return restore, clients


def memory_step(graph, state, runtime):
    """At most one pending entry per run; no all-ticker settlement backlog."""
    from tradingagents.memory import settlement
    from tradingagents.dataflows.config import run_config
    note = ''
    token = MEMORY.set(True)
    runtime.memory_deadline = time.monotonic() + 25
    try:
        pending = graph.memory_log.get_pending_entries()
        if pending:
            # Prefer oldest; retained records preserve settlement's own lock and
            # update logic. Only this view is bounded, never modify the real log.
            entry = min(pending, key=lambda e: e['date'])
            class OneEntry:
                def get_pending_entries(self):
                    return [e for e in graph.memory_log.get_pending_entries()
                            if e['ticker'] == entry['ticker'] and e['date'] == entry['date']][:1]
                def __getattr__(self, name):
                    return getattr(graph.memory_log, name)
            with run_config(graph.config):
                done = settlement.settle_pending(entry['ticker'], OneEntry(), graph.reflector, graph.config, wait=False)
            if len(pending) > len(done.settled):
                note = 'Memory maintenance is limited to one pending decision per run; remaining entries are deferred.'
    except Exception:
        note = 'Memory maintenance deferred; previously available lessons are used.'
    finally:
        MEMORY.reset(token)
    try:
        context = graph.memory_log.get_past_context(state['company_of_interest'],
                    as_of=graph._memory_as_of(state['trade_date']))
    except Exception:
        context = ''
        note = 'Memory unavailable; this report has no prior lessons.'
    return {'past_context': context, 'memory_note': note}


def install_data_limits(runtime):
    """Bound supported HTTP calls and reuse immutable dated Yahoo frames.

    Per-request socket timeouts are not total tool wall deadlines. The detached
    supervisor still kills blocked work at the ticker's immutable deadline.
    """
    import requests
    import curl_cffi.requests
    restores = []
    for cls in (requests.sessions.Session, curl_cffi.requests.Session):
        original = cls.request
        def bounded(self, *args, _original=original, **kwargs):
            runtime.check()
            seconds = max(.1, min(20., runtime.remaining()))
            if MEMORY.get():
                seconds = max(.1, min(seconds, runtime.memory_deadline - time.monotonic()))
            old = kwargs.get('timeout')
            if isinstance(old, (int, float)):
                seconds = min(seconds, old)
            elif isinstance(old, tuple):
                kwargs['timeout'] = tuple(min(seconds, n) if isinstance(n, (int, float)) else seconds for n in old)
            if not isinstance(old, tuple):
                kwargs['timeout'] = seconds
            return _original(self, *args, **kwargs)
        cls.request = bounded
        restores.append((cls, 'request', original))

    import tradingagents.dataflows.vendors.yahoo.snapshot as snapshot
    # Import all vendor modules already used by the router, then replace their
    # bound load_ohlcv references. Keys include fill_gaps: verification must not
    # accidentally consume a gap-filled frame from the indicator path.
    import sys
    import tradingagents.dataflows.vendors.yahoo.ohlcv as ohlcv
    original_load = ohlcv.load_ohlcv
    cache, lock = {}, threading.RLock()
    def load(symbol, as_of_date, fill_gaps=True):
        key = (symbol, as_of_date, fill_gaps)
        with lock:
            runtime.check()
            if key not in cache:
                cache[key] = original_load(symbol, as_of_date, fill_gaps=fill_gaps)
            return cache[key].copy(deep=True)
    for name, module in list(sys.modules.items()):
        if name.startswith('tradingagents.dataflows.vendors.yahoo') and getattr(module, 'load_ohlcv', None) is original_load:
            restores.append((module, 'load_ohlcv', original_load))
            module.load_ohlcv = load
    def restore():
        for obj, name, original in reversed(restores):
            setattr(obj, name, original)
    return restore
