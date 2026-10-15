"""Sanitize provider values before result messages and result/error callbacks.

Only copies of this graph's StructuredTools are adapted; upstream tool objects,
schemas, metadata and the graph's ToolNode error policy remain unchanged.

Upstream v0.6.0 builds each analyst's ToolNode from frozen
``AnalystNodeSpec`` tuples and offers no per-graph tool hook, so this module
also provides a pinned application adapter: ``install_safe_plan`` serves
sanitized spec copies to graph setup, and ``install_sentiment_safety`` covers
the Sentiment node's direct (non-ToolNode) fetches. Both are guarded to the
reviewed upstream version and fail loudly on upstream refactors.
"""
import dataclasses
from functools import wraps

import tradingagents
from langchain_core.messages import BaseMessage
from langchain_core.tools import StructuredTool, ToolException
from langgraph.errors import GraphBubbleUp
from tradingagents.memory.reflection import Reflector

from desk_process import redact

EXPECTED_UPSTREAM_VERSION = "0.6.0"


def assert_upstream_version():
    version = getattr(tradingagents, "__version__", None)
    if version != EXPECTED_UPSTREAM_VERSION:
        raise RuntimeError(
            "Desk tool adapter pins tradingagents "
            f"{EXPECTED_UPSTREAM_VERSION}, found {version!r}"
        )


def clean(value):
    """Keep useful values/types, including tool content-and-artifact tuples."""
    if isinstance(value, str):
        return redact(value)
    if isinstance(value, BaseMessage):
        return value.model_copy(update={k: clean(v) for k, v in value.__dict__.items()})
    if isinstance(value, dict):
        return {clean(k): clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean(v) for v in value]
    if isinstance(value, tuple):
        return tuple(clean(v) for v in value)
    return value


def safe_error(exc):
    # Carry only public error text, never provider request/response objects,
    # hidden args or chains. LangGraph persists repr(exception); sanitizing str
    # alone while rethrowing the original object is insufficient. Retain the
    # tool error / value error families and the pinned ToolNode's abort policy.
    kind = ToolException if isinstance(exc, ToolException) else (
        ValueError if isinstance(exc, ValueError) else RuntimeError)
    return kind(redact(str(exc)))


RUNTIME = None


def safe_tool(tool):
    if not isinstance(tool, StructuredTool):
        raise TypeError('Desk requires structured provider tools')
    updates = {}
    if tool.func is not None:
        func = tool.func

        @wraps(func)
        def run(*args, **kwargs):
            try:
                value = RUNTIME.tool(tool.name, func, args, kwargs) if RUNTIME else func(*args, **kwargs)
                return clean(value)
            except GraphBubbleUp:
                raise
            except Exception as exc:
                error = safe_error(exc)
            # Raise after leaving the handler: `from None` inside it would
            # merely hide (but retain) the raw provider exception as context.
            raise error from None

        updates['func'] = run
    if tool.coroutine is not None:
        coroutine = tool.coroutine

        @wraps(coroutine)
        async def arun(*args, **kwargs):
            try:
                return clean(await coroutine(*args, **kwargs))
            except GraphBubbleUp:
                raise
            except Exception as exc:
                error = safe_error(exc)
            raise error from None

        updates['coroutine'] = arun
    return tool.model_copy(update=updates)


def _require_safe_tool(tool):
    if not isinstance(tool, StructuredTool):
        raise TypeError(
            'Desk requires structured provider tools, found '
            f'{type(tool).__name__}'
        )
    return safe_tool(tool)


def safe_plan(selected_analysts):
    """Analyst execution plan with sanitized tool copies (pinned adapter).

    Specs are frozen dataclasses, so build replacements instead of mutating
    them. Upstream tool objects, schemas and metadata remain unchanged; only
    the copies served to this graph's ToolNodes are wrapped.
    """
    from tradingagents.graph.analyst_execution import build_analyst_execution_plan
    plan = build_analyst_execution_plan(selected_analysts)
    specs = [
        dataclasses.replace(spec, tools=tuple(_require_safe_tool(t) for t in spec.tools))
        for spec in plan.specs
    ]
    return dataclasses.replace(plan, specs=specs)


def install_safe_plan():
    """Serve sanitized specs to graph setup for this process. Returns restore().

    Patches the setup-time plan-builder reference (resolved at call time by
    ``GraphSetup.setup_graph``), so analyst ToolNodes execute wrapped copies.
    Must be installed before the graph is constructed.
    """
    assert_upstream_version()
    import tradingagents.graph.setup as setup
    if not hasattr(setup, 'build_analyst_execution_plan'):
        raise RuntimeError('Desk tool adapter: upstream moved the plan builder')
    original = setup.build_analyst_execution_plan

    def safe_builder(selected_analysts):
        plan = original(selected_analysts)
        specs = [
            dataclasses.replace(spec, tools=tuple(_require_safe_tool(t) for t in spec.tools))
            for spec in plan.specs
        ]
        return dataclasses.replace(plan, specs=specs)

    setup.build_analyst_execution_plan = safe_builder

    def restore():
        setup.build_analyst_execution_plan = original

    return restore


def _redacting_fetcher(func):
    # Plain vendor fetchers return prompt-bound text, not tool results.
    @wraps(func)
    def wrapper(*args, **kwargs):
        result = func(*args, **kwargs)
        return clean(result)
    return wrapper


def install_sentiment_safety():
    """Sanitize the Sentiment node's direct (non-ToolNode) fetches. Returns restore().

    The node calls ``get_news.func`` plus the StockTwits/Reddit fetchers
    outside any ToolNode, so spec wrapping cannot cover them. Patching is
    confined to the sentiment module's globals; other analysts' tool objects
    are unaffected because ``safe_tool`` operates on copies.
    """
    assert_upstream_version()
    import tradingagents.agents.analysts.sentiment_analyst as sentiment
    for name in ('get_news', 'fetch_stocktwits_messages', 'fetch_reddit_posts'):
        if not hasattr(sentiment, name):
            raise RuntimeError(f'Desk sentiment adapter: upstream removed {name!r}')
    originals = {name: getattr(sentiment, name) for name in (
        'get_news', 'fetch_stocktwits_messages', 'fetch_reddit_posts')}
    # The node calls get_news.func(...): wrapping the copy wraps its func.
    sentiment.get_news = _require_safe_tool(originals['get_news'])
    sentiment.fetch_stocktwits_messages = _redacting_fetcher(originals['fetch_stocktwits_messages'])
    sentiment.fetch_reddit_posts = _redacting_fetcher(originals['fetch_reddit_posts'])

    def restore():
        for name, func in originals.items():
            setattr(sentiment, name, func)

    return restore


class SafeReflector(Reflector):
    """Upstream settlement reflection with sanitized prose.

    Reflection text is written verbatim to the memory log and re-injected into
    later prompts, so clean it at the source before either path.
    """
    def reflect_on_final_decision(self, *args, **kwargs):
        return clean(super().reflect_on_final_decision(*args, **kwargs))
