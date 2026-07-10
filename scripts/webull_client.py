#!/usr/bin/env python3
"""Webull OpenAPI CLI — broker read-only + market snapshots/bars.

Stdout is always JSON. Logs go to stderr.
Env: WEBULL_APP_KEY, WEBULL_APP_SECRET, WEBULL_REGION_ID, WEBULL_ENVIRONMENT,
     WEBULL_RATE_LIMIT_PER_MIN
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

# Allow importing sibling modules when spawned from Node
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

try:
    import pandas as pd
except ImportError:
    pd = None  # type: ignore

try:
    from webull_cache import (
        BARS_TTL_SEC,
        SNAPSHOT_TTL_SEC,
        cached_call,
    )
except ImportError:
    BARS_TTL_SEC = 300.0
    SNAPSHOT_TTL_SEC = 60.0

    def cached_call(key, ttl_sec, fn):  # type: ignore
        return fn()


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def is_configured() -> bool:
    return bool(_env("WEBULL_APP_KEY") and _env("WEBULL_APP_SECRET"))


def is_us_equity_symbol(symbol: str) -> bool:
    """US equities/ETFs only for v1 Webull market data. Crypto/futures → Yahoo."""
    s = (symbol or "").strip().upper()
    if not s:
        return False
    if s.endswith("-USD") or s.endswith("=F") or "/" in s:
        return False
    if s.startswith("^"):
        return False
    return True


def _pick(row: Dict[str, Any], *keys: str, default: Any = None) -> Any:
    """Read camelCase or snake_case keys from Webull payloads."""
    for key in keys:
        if key in row and row[key] is not None and row[key] != "":
            return row[key]
        snake = "".join(["_" + c.lower() if c.isupper() else c for c in key]).lstrip("_")
        if snake in row and row[snake] is not None and row[snake] != "":
            return row[snake]
        camel = "".join(part.capitalize() if i else part for i, part in enumerate(key.split("_")))
        if camel != key and camel in row and row[camel] is not None and row[camel] != "":
            return row[camel]
    return default


def _response_json(res: Any) -> Any:
    """Normalize SDK response. Docs: check status_code == 200 then res.json()."""
    if res is None:
        return None
    status = getattr(res, "status_code", None)
    if status is not None and status != 200:
        text = getattr(res, "text", "") or str(res)
        raise RuntimeError(f"webull_http_{status}: {text[:300]}")
    if hasattr(res, "json") and callable(res.json):
        try:
            return res.json()
        except Exception as e:
            raise RuntimeError(f"webull_json_parse: {e}") from e
    if isinstance(res, (dict, list)):
        return res
    return res


def _as_rows(data: Any, *list_keys: str) -> List[Any]:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in list_keys:
            val = data.get(key)
            if isinstance(val, list):
                return val
        # Single account object
        if _pick(data, "account_id", "accountId"):
            return [data]
    return []


def _build_api_client():
    from webull.core.client import ApiClient

    key = _env("WEBULL_APP_KEY")
    secret = _env("WEBULL_APP_SECRET")
    region = _env("WEBULL_REGION_ID", "us")
    env = _env("WEBULL_ENVIRONMENT", "prod").lower()
    token_dir = _env("WEBULL_TOKEN_DIR")

    client = ApiClient(key, secret, region)
    if token_dir:
        client.set_token_dir(token_dir)
    # Docs: UAT uses us-openapi-alb.uat.webullbroker.com; prod uses default SDK endpoint.
    if env in ("uat", "sandbox", "test"):
        try:
            client.add_endpoint(region, "us-openapi-alb.uat.webullbroker.com")
        except Exception:
            client.add_endpoint(region, "api.sandbox.webull.com")
    return client


def get_data_client():
    from webull.data.data_client import DataClient

    return DataClient(_build_api_client())


def get_trade_client():
    from webull.trade.trade_client import TradeClient

    return TradeClient(_build_api_client())


def health() -> Dict[str, Any]:
    if not is_configured():
        return {
            "ok": False,
            "configured": False,
            "environment": _env("WEBULL_ENVIRONMENT", "prod"),
            "error": "WEBULL_APP_KEY / WEBULL_APP_SECRET not set",
        }
    try:
        accounts = list_accounts()
        if accounts.get("error"):
            raise RuntimeError(accounts["error"])
        return {
            "ok": True,
            "configured": True,
            "environment": _env("WEBULL_ENVIRONMENT", "prod"),
            "region": _env("WEBULL_REGION_ID", "us"),
            "accounts": len(accounts.get("accounts") or []),
        }
    except Exception as e:
        return {
            "ok": False,
            "configured": True,
            "environment": _env("WEBULL_ENVIRONMENT", "prod"),
            "error": str(e)[:300],
        }


def list_accounts() -> Dict[str, Any]:
    """Account List — Webull docs return account_id / account_type / account_number (snake_case)."""
    if not is_configured():
        return {"error": "not_configured", "configured": False, "accounts": []}
    try:
        trade = get_trade_client()
        data = _response_json(trade.account_v2.get_account_list())
        accounts = []
        for row in _as_rows(data, "accounts", "data", "list", "result"):
            if not isinstance(row, dict):
                continue
            account_id = str(_pick(row, "account_id", "accountId", "id") or "")
            if not account_id:
                continue
            accounts.append({
                "accountId": account_id,
                "accountType": str(_pick(row, "account_type", "accountType", "type") or ""),
                "accountNumber": str(_pick(row, "account_number", "accountNumber") or ""),
                "accountClass": str(_pick(row, "account_class", "accountClass", "class") or ""),
                "label": str(_pick(row, "account_label", "accountLabel", "label", "account_name", "accountName") or ""),
                "userId": str(_pick(row, "user_id", "userId") or ""),
                "currency": str(_pick(row, "currency") or "USD"),
                "raw": {k: row[k] for k in list(row.keys())[:16]},
            })
        return {"configured": True, "accounts": accounts}
    except Exception as e:
        return {"error": str(e)[:300], "configured": True, "accounts": []}


def get_balance(account_id: str) -> Dict[str, Any]:
    if not is_configured():
        return {"error": "not_configured", "configured": False}
    try:
        trade = get_trade_client()
        data = _response_json(trade.account_v2.get_account_balance(account_id))
        if not isinstance(data, dict):
            return {"accountId": account_id, "raw": data}

        # Nested currency buckets — Webull returns account_currency_assets: [{ currency, ... }]
        nested = None
        for key in (
            "account_currency_assets",
            "accountCurrencyAssets",
            "currencyAssets",
            "assets",
            "USD",
            "usd",
        ):
            val = data.get(key)
            if isinstance(val, dict):
                nested = val
                break
            if isinstance(val, list) and val:
                usd = next((x for x in val if isinstance(x, dict) and str(x.get("currency", "")).upper() == "USD"), None)
                nested = usd or (val[0] if isinstance(val[0], dict) else None)
                break

        src = nested if isinstance(nested, dict) else {}

        total_cash = _num(
            _pick(data, "total_cash_balance", "totalCashBalance", "totalCash", "cashBalance", "cash")
            or _pick(src, "cash_balance", "cashBalance", "total_cash_balance", "totalCash", "cash")
        )
        buying_power = _num(
            _pick(src, "buying_power", "buyingPower", "dayBuyingPower")
            or _pick(data, "buying_power", "buyingPower", "dayBuyingPower")
        )
        market_value = _num(
            _pick(data, "total_market_value", "totalMarketValue", "marketValue")
            or _pick(src, "market_value", "marketValue", "total_market_value")
        )
        net_liq = _num(
            _pick(
                data,
                "total_net_liquidation_value",
                "totalNetLiquidationValue",
                "net_liquidation_value",
                "netLiquidationValue",
                "netLiquidation",
                "net_liquidation",
                "totalEquity",
                "totalAccountValue",
            )
            or _pick(src, "net_liquidation_value", "netLiquidationValue", "netLiquidation", "totalEquity")
        )

        return {
            "accountId": account_id,
            "totalCash": total_cash,
            "buyingPower": buying_power,
            "totalMarketValue": market_value,
            "netLiquidation": net_liq,
            "currency": str(
                _pick(data, "total_asset_currency", "totalAssetCurrency", "currency")
                or _pick(src, "currency")
                or "USD"
            ),
            "raw": data,
        }
    except Exception as e:
        return {"error": str(e)[:300], "accountId": account_id, "configured": True}


def get_positions(account_id: str) -> Dict[str, Any]:
    if not is_configured():
        return {"error": "not_configured", "configured": False, "positions": []}
    try:
        trade = get_trade_client()
        data = _response_json(trade.account_v2.get_account_position(account_id))
        rows = _as_rows(data, "positions", "data", "holdings", "list", "result")
        positions = []
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            instrument = row.get("instrument") if isinstance(row.get("instrument"), dict) else {}
            symbol = str(
                _pick(row, "symbol", "ticker")
                or _pick(instrument, "symbol", "ticker")
                or ""
            ).upper()
            if not symbol:
                continue
            positions.append({
                "symbol": symbol,
                "quantity": _num(_pick(row, "quantity", "qty", "position", "positionQty")),
                "avgCost": _num(_pick(row, "avgCost", "averageCost", "costPrice", "avg_cost", "average_cost")),
                "marketValue": _num(_pick(row, "marketValue", "market_value")),
                "unrealizedPnl": _num(
                    _pick(
                        row,
                        "unrealizedProfitLoss",
                        "unrealizedPnl",
                        "unrealizedPL",
                        "unrealized_profit_loss",
                        "unrealized_pnl",
                    )
                ),
                "lastPrice": _num(_pick(row, "lastPrice", "marketPrice", "price", "last_price", "market_price")),
            })
        return {"accountId": account_id, "positions": positions, "configured": True}
    except Exception as e:
        return {"error": str(e)[:300], "accountId": account_id, "positions": [], "configured": True}


def get_orders(account_id: str) -> Dict[str, Any]:
    if not is_configured():
        return {"error": "not_configured", "configured": False, "open": [], "history": []}
    try:
        trade = get_trade_client()
        open_raw = _response_json(trade.order_v2.get_order_open(account_id, page_size=50))
        hist_raw = _response_json(trade.order_v2.get_order_history(account_id, page_size=50))
        return {
            "accountId": account_id,
            "open": _normalize_orders(open_raw),
            "history": _normalize_orders(hist_raw),
            "configured": True,
        }
    except Exception as e:
        return {"error": str(e)[:300], "accountId": account_id, "open": [], "history": [], "configured": True}


def _normalize_orders(data: Any) -> List[Dict[str, Any]]:
    rows = data
    if isinstance(data, dict):
        rows = data.get("orders") or data.get("data") or data.get("list") or []
    out = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        out.append({
            "clientOrderId": str(row.get("clientOrderId") or row.get("orderId") or ""),
            "symbol": str(row.get("symbol") or "").upper(),
            "side": str(row.get("side") or row.get("action") or ""),
            "status": str(row.get("status") or row.get("orderStatus") or ""),
            "quantity": _num(row.get("quantity") or row.get("qty")),
            "filledQuantity": _num(row.get("filledQuantity") or row.get("filledQty")),
            "limitPrice": _num(row.get("limitPrice") or row.get("price")),
        })
    return out


def _num(val: Any, default: float = 0.0) -> float:
    if val is None or val == "":
        return default
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _parse_snapshot_row(row: Dict[str, Any], symbol: str) -> Dict[str, Any]:
    last = _num(
        row.get("last")
        or row.get("close")
        or row.get("price")
        or row.get("tradePrice")
        or row.get("pPrice")
    )
    prev = _num(row.get("priorClose") or row.get("preClose") or row.get("previousClose"))
    change = _num(row.get("change") or row.get("changeAmount"))
    change_pct = _num(row.get("changeRatio") or row.get("changePercent") or row.get("chgRate"))
    if change_pct and abs(change_pct) < 1 and abs(change_pct) > 0:
        # Some APIs return ratio (0.01 = 1%)
        if abs(change_pct) <= 0.5:
            change_pct = change_pct * 100
    if change == 0 and last and prev:
        change = last - prev
        change_pct = (change / prev) * 100 if prev else 0
    as_of = row.get("tradeTime") or row.get("timestamp") or row.get("time") or ""
    if isinstance(as_of, (int, float)) and as_of > 1e11:
        as_of = datetime.fromtimestamp(as_of / 1000, tz=timezone.utc).isoformat()
    elif isinstance(as_of, (int, float)) and as_of > 1e9:
        as_of = datetime.fromtimestamp(as_of, tz=timezone.utc).isoformat()
    return {
        "symbol": symbol.upper(),
        "price": last,
        "previousClose": prev,
        "change": change,
        "changePercent": change_pct,
        "bid": _num(row.get("bid") or row.get("bidPrice")),
        "ask": _num(row.get("ask") or row.get("askPrice")),
        "volume": _num(row.get("volume") or row.get("tradeVolume") or row.get("totalVolume")),
        "open": _num(row.get("open") or row.get("openPrice")),
        "dayHigh": _num(row.get("high") or row.get("dayHigh")),
        "dayLow": _num(row.get("low") or row.get("dayLow")),
        "asOf": str(as_of),
        "name": str(row.get("name") or row.get("symbolName") or symbol.upper()),
    }


def get_snapshot(symbol: str) -> Optional[Dict[str, Any]]:
    """Single-symbol snapshot. Returns None if not configured / not US equity / error."""
    if not is_configured() or not is_us_equity_symbol(symbol):
        return None
    sym = symbol.strip().upper()

    def _fetch():
        data = get_data_client()
        res = data.market_data.get_snapshot(sym, "US_STOCK", extend_hour_required=True)
        payload = _response_json(res)
        row = None
        if isinstance(payload, list) and payload:
            row = payload[0]
        elif isinstance(payload, dict):
            if "data" in payload and isinstance(payload["data"], list) and payload["data"]:
                row = payload["data"][0]
            elif "result" in payload and isinstance(payload["result"], list) and payload["result"]:
                row = payload["result"][0]
            elif payload.get("symbol") or payload.get("last") or payload.get("close"):
                row = payload
        if not row or not isinstance(row, dict):
            raise RuntimeError(f"empty_snapshot:{sym}")
        return _parse_snapshot_row(row, sym)

    try:
        return cached_call(f"snap:{sym}", SNAPSHOT_TTL_SEC, _fetch)
    except Exception as e:
        print(f"Webull snapshot failed for {sym}: {e}", file=sys.stderr)
        return None


def get_snapshots_batch(symbols: List[str]) -> Dict[str, Dict[str, Any]]:
    """Batch snapshots for US equities. Returns map symbol → quote dict."""
    if not is_configured():
        return {}
    us = [s.strip().upper() for s in symbols if is_us_equity_symbol(s)]
    us = list(dict.fromkeys(us))[:100]
    if not us:
        return {}

    # Serve from cache where possible
    out: Dict[str, Dict[str, Any]] = {}
    missing: List[str] = []
    for s in us:
        hit = None
        try:
            from webull_cache import cache_get
            hit = cache_get(f"snap:{s}")
        except Exception:
            hit = None
        if hit:
            out[s] = hit
        else:
            missing.append(s)
    if not missing:
        return out

    def _fetch():
        data = get_data_client()
        res = data.market_data.get_snapshot(",".join(missing), "US_STOCK", extend_hour_required=True)
        payload = _response_json(res)
        rows = payload
        if isinstance(payload, dict):
            rows = payload.get("data") or payload.get("result") or []
        result = {}
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            sym = str(row.get("symbol") or "").upper()
            if not sym:
                continue
            parsed = _parse_snapshot_row(row, sym)
            result[sym] = parsed
            try:
                from webull_cache import cache_set
                cache_set(f"snap:{sym}", parsed, SNAPSHOT_TTL_SEC)
            except Exception:
                pass
        return result

    try:
        fetched = cached_call(f"snap_batch:{','.join(missing)}", SNAPSHOT_TTL_SEC, _fetch)
        out.update(fetched or {})
    except Exception as e:
        print(f"Webull batch snapshot failed: {e}", file=sys.stderr)
    return out


def get_bars_dataframe(symbol: str, count: int = 260):
    """Return OHLCV DataFrame (columns Open, High, Low, Close, Volume) or None."""
    if pd is None or not is_configured() or not is_us_equity_symbol(symbol):
        return None
    sym = symbol.strip().upper()
    count = max(20, min(int(count), 1200))

    def _fetch():
        data = get_data_client()
        res = data.market_data.get_history_bar(sym, "US_STOCK", "D", count=str(count), real_time_required=True)
        payload = _response_json(res)
        rows = payload
        if isinstance(payload, dict):
            rows = payload.get("data") or payload.get("result") or payload.get("bars") or []
        records = []
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            ts = row.get("timestamp") or row.get("time") or row.get("date") or row.get("t")
            o = _num(row.get("open") or row.get("o"))
            h = _num(row.get("high") or row.get("h"))
            l = _num(row.get("low") or row.get("l"))
            c = _num(row.get("close") or row.get("c") or row.get("last"))
            v = _num(row.get("volume") or row.get("v"))
            if not c:
                continue
            if isinstance(ts, (int, float)):
                if ts > 1e11:
                    idx = datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
                else:
                    idx = datetime.fromtimestamp(ts, tz=timezone.utc)
            else:
                try:
                    idx = pd.to_datetime(ts)
                except Exception:
                    continue
            records.append({"Date": idx, "Open": o, "High": h, "Low": l, "Close": c, "Volume": v})
        if not records:
            raise RuntimeError(f"empty_bars:{sym}")
        df = pd.DataFrame(records).set_index("Date").sort_index()
        return df

    try:
        return cached_call(f"bars:{sym}:{count}", BARS_TTL_SEC, _fetch)
    except Exception as e:
        print(f"Webull bars failed for {sym}: {e}", file=sys.stderr)
        return None


def bars_to_records(df) -> List[Dict[str, Any]]:
    if df is None or getattr(df, "empty", True):
        return []
    records = []
    for date, row in df.iterrows():
        records.append({
            "date": date.strftime("%Y-%m-%d") if hasattr(date, "strftime") else str(date)[:10],
            "open": float(row.get("Open", 0) or 0),
            "high": float(row.get("High", 0) or 0),
            "low": float(row.get("Low", 0) or 0),
            "close": float(row.get("Close", 0) or 0),
            "volume": float(row.get("Volume", 0) or 0),
        })
    return records


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "help"
    arg2 = sys.argv[2] if len(sys.argv) > 2 else ""

    if action == "health":
        print(json.dumps(health()))
    elif action == "accounts":
        print(json.dumps(list_accounts()))
    elif action == "balance":
        print(json.dumps(get_balance(arg2)))
    elif action == "positions":
        print(json.dumps(get_positions(arg2)))
    elif action == "orders":
        print(json.dumps(get_orders(arg2)))
    elif action == "snapshot":
        snap = get_snapshot(arg2)
        print(json.dumps(snap if snap else {"error": "unavailable", "symbol": arg2}))
    elif action == "snapshots":
        symbols = [s.strip() for s in arg2.split(",") if s.strip()]
        print(json.dumps(get_snapshots_batch(symbols)))
    elif action == "bars":
        df = get_bars_dataframe(arg2)
        print(json.dumps({"symbol": arg2, "bars": bars_to_records(df)}))
    else:
        print(json.dumps({
            "error": f"Unknown action: {action}",
            "actions": ["health", "accounts", "balance", "positions", "orders", "snapshot", "snapshots", "bars"],
        }))
