#!/usr/bin/env python3
"""Long-lived Webull trade-events worker (Phase 3).

This does not fit a Next.js API route (gRPC stream). Run separately:

  python scripts/webull_events.py subscribe <account_id>

Logs go to stderr. Each event is one JSON object on stdout (or WEBULL_EVENTS_OUT file).
The Next.js app still polls order-detail for MVP; this worker is optional fill push.
"""
from __future__ import annotations

import json
import os
import sys

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from webull_client import (  # noqa: E402
    _configure_sdk_logging,
    _emit,
    _environment,
    _redirect_stdout_to_stderr,
    get_trade_client,
    is_configured,
)


def subscribe(account_id: str) -> None:
    if not is_configured():
        _emit({"error": "not_configured"})
        return
    try:
        from webull.trade.events.trade_events_client import TradeEventsClient
    except Exception:
        try:
            from webull.trade.trade_events_client import TradeEventsClient  # type: ignore
        except Exception as e:
            _emit({"error": f"TradeEventsClient unavailable: {e}"[:300]})
            return

    out_path = (os.environ.get("WEBULL_EVENTS_OUT") or "").strip()
    out_fp = open(out_path, "a", encoding="utf-8") if out_path else None

    def on_event(event: object) -> None:
        payload = event
        if hasattr(event, "__dict__"):
            payload = getattr(event, "__dict__", event)
        line = json.dumps({"accountId": account_id, "environment": _environment(), "event": payload}, default=str)
        if out_fp:
            out_fp.write(line + "\n")
            out_fp.flush()
        else:
            sys.__stdout__.write(line + "\n")
            sys.__stdout__.flush()

    client = TradeEventsClient(get_trade_client().api_client) if hasattr(get_trade_client(), "api_client") else TradeEventsClient()
    print(f"subscribing trade events account={account_id}", file=sys.stderr)
    # Official getting-started: blocking do_subscribe
    subscribe_fn = getattr(client, "do_subscribe", None) or getattr(client, "subscribe", None)
    if subscribe_fn is None:
        _emit({"error": "events client has no subscribe method"})
        return
    try:
        subscribe_fn(accounts=[account_id], callback=on_event)
    except TypeError:
        subscribe_fn(account_id)


if __name__ == "__main__":
    _redirect_stdout_to_stderr()
    _configure_sdk_logging()
    action = sys.argv[1] if len(sys.argv) > 1 else "help"
    account_id = sys.argv[2] if len(sys.argv) > 2 else ""
    if action == "subscribe" and account_id:
        subscribe(account_id)
    else:
        _emit({
            "error": "usage: python scripts/webull_events.py subscribe <account_id>",
            "note": "Long-lived gRPC worker; not used by Next.js routes.",
        })
