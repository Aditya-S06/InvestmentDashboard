"""Sanitize provider values before result messages and result/error callbacks.

Only copies of this graph's StructuredTools are adapted; upstream tool objects,
schemas, metadata and the graph's ToolNode error policy remain unchanged.
"""
from functools import wraps

from langchain_core.messages import BaseMessage
from langchain_core.tools import StructuredTool, ToolException
from langgraph.errors import GraphBubbleUp

from desk_process import redact


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


def safe_tool(tool):
    if not isinstance(tool, StructuredTool):
        raise TypeError('Desk requires structured provider tools')
    updates = {}
    if tool.func is not None:
        func = tool.func

        @wraps(func)
        def run(*args, **kwargs):
            try:
                return clean(func(*args, **kwargs))
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
