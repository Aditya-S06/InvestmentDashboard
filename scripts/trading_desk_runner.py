"""Trading Desk runner: wraps TauricResearch/TradingAgents for Project Oracle.

Runs TradingAgentsGraph for one ticker and emits JSONL events (one JSON object
per line, flushed) on stdout for the Desk spawn/stream layer (desk-4). stdout
is reserved for events: everything the graph prints in debug mode goes to
stderr instead.

Usage:
  python scripts/trading_desk_runner.py \
    --ticker NVDA --as-of 2026-09-09 --depth fast \
    --analysts market,social,news,fundamentals \
    --asset-type stock --checkpoint false \
    --out /tmp/desk-out.json --results-dir /tmp/desk-results \
    --memory-log-path /tmp/trading_memory.md \
    --data-cache-dir /tmp/cache

Env: OPENROUTER_API_KEY (required), OPENROUTER_BASE_URL (optional),
DESK_DEEP_MODEL / DESK_QUICK_MODEL (required). Never calls input().
API keys are never accepted on the CLI; they stay in the environment.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any
sys.path.insert(0, str(Path(__file__).resolve().parent))
from desk_process import atomic_json, redact as redact_process_secrets

import dotenv

# This application entry point accepts only its explicitly supplied environment.
# TradingAgents loads .env and .env.enterprise at import. Block that before any
# imports, including on python-dotenv 1.0/1.1 (which lack PYTHON_DOTENV_DISABLED).
def _ignore_dotenv(*args: Any, **kwargs: Any) -> bool:
    return False


dotenv.load_dotenv = _ignore_dotenv

# tradingagents lives in the Tauric clone at <repo>/TradingAgents (TauricPlan).
# The desk-4 spawn sets PYTHONPATH to that directory; insert it here too so the
# runner works standalone. Must run before the tradingagents imports below.
_TRADINGAGENTS_DIR = Path(__file__).resolve().parent.parent / "TradingAgents"
if str(_TRADINGAGENTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TRADINGAGENTS_DIR))

from langchain_core.callbacks import BaseCallbackHandler  # noqa: E402
from tradingagents.agents.utils.rating import RATING_REVIEW, RATINGS_5_TIER  # noqa: E402
from tradingagents.default_config import DEFAULT_CONFIG  # noqa: E402
from tradingagents.graph.trading_graph import TradingAgentsGraph as _TradingAgentsGraph  # noqa: E402


class TradingAgentsGraph(_TradingAgentsGraph):
    """App-owned boundaries, installed before upstream compiles its workflow."""
    def __init__(self, *args, **kwargs):
        from desk_memory import DeskMemoryLog
        super().__init__(*args, **kwargs)
        self.memory_log = DeskMemoryLog(self.config)

    def _create_tool_nodes(self):
        from desk_tool_safety import safe_tool
        nodes = super()._create_tool_nodes()
        for node in nodes.values():
            node.tools_by_name.update({name: safe_tool(tool) for name, tool in node.tools_by_name.items()})
        return nodes

# Real stdout, captured before main() points sys.stdout at stderr. Only JSONL
# events are ever written here.
_EVENT_STREAM = sys.stdout
if hasattr(_EVENT_STREAM, "reconfigure"):
    _EVENT_STREAM.reconfigure(encoding="utf-8", errors="strict", newline="\n")

DEPTH_ROUNDS = {"fast": 1, "standard": 3, "deep": 5}

TAURIC_ANALYST_ORDER = ("market", "social", "news", "fundamentals")

# LangGraph node name -> Desk agent key (TauricPlan `agent` vocabulary).
NODE_AGENTS = {
    "Market Analyst": "market",
    "Sentiment Analyst": "social",
    "News Analyst": "news",
    "Fundamentals Analyst": "fundamentals",
    "Bull Researcher": "bull",
    "Bear Researcher": "bear",
    "Research Manager": "research_manager",
    "Trader": "trader",
    "Aggressive Analyst": "risky",
    "Conservative Analyst": "safe",
    "Neutral Analyst": "neutral",
    "Portfolio Manager": "portfolio_manager",
}

AGENT_PHASES = {
    "market": "analysts",
    "social": "analysts",
    "news": "analysts",
    "fundamentals": "analysts",
    "bull": "debate",
    "bear": "debate",
    "research_manager": "research_manager",
    "trader": "trader",
    "risky": "risk",
    "safe": "risk",
    "neutral": "risk",
    "portfolio_manager": "portfolio_manager",
}

ANALYST_REPORT_KEYS = {
    "market": "market_report",
    "social": "sentiment_report",
    "news": "news_report",
    "fundamentals": "fundamentals_report",
}

RISK_RESPONSE_KEYS = {
    "risky": "current_aggressive_response",
    "safe": "current_conservative_response",
    "neutral": "current_neutral_response",
}

# Debater turns are prefixed "Bull Analyst: ..." etc.; the event's agent/side
# field already carries the speaker, so strip the label from the text.
_SPEAKER_LABEL_RE = re.compile(r"^\s*\w+ (Analyst|Researcher):\s*")

_SECRET_ENV_NAMES = ("OPENROUTER_API_KEY", "OPENAI_API_KEY")
_SECRET_ASSIGN_RE = re.compile(
    r"\b(OPENROUTER_API_KEY|OPENAI_API_KEY)\s*[=:]\s*(['\"]?)[^\s'\"]*\2"
)
_SECRET_JSON_RE = re.compile(
    r'"(OPENROUTER_API_KEY|OPENAI_API_KEY)"\s*:\s*"[^"]*"'
)


def redact_secrets(text: str) -> str:
    """Strip API keys and env dumps from logs / error strings."""
    if not text:
        return text
    out = redact_process_secrets(text)
    for name in _SECRET_ENV_NAMES:
        value = os.environ.get(name) or ""
        if value:
            out = out.replace(value, f"[{name}_REDACTED]")
    out = _SECRET_ASSIGN_RE.sub(r"\1=[REDACTED]", out)
    out = _SECRET_JSON_RE.sub(r'"\1":"[REDACTED]"', out)
    return out


class _RedactingWriter:
    def __init__(self, inner: Any) -> None:
        self._inner = inner

    def write(self, s: Any) -> int:
        if isinstance(s, bytes):
            s = s.decode("utf-8", "replace")
        elif not isinstance(s, str):
            s = str(s)
        return int(self._inner.write(redact_secrets(s)) or 0)

    def flush(self) -> None:
        flush = getattr(self._inner, "flush", None)
        if flush:
            flush()

    def reconfigure(self, **kwargs: Any) -> None:
        reconfigure = getattr(self._inner, "reconfigure", None)
        if reconfigure:
            reconfigure(**kwargs)

    def isatty(self) -> bool:
        isatty = getattr(self._inner, "isatty", None)
        return bool(isatty()) if isatty else False

    @property
    def encoding(self) -> str:
        return str(getattr(self._inner, "encoding", "utf-8"))

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


def emit(event: dict[str, Any]) -> None:
    """Write one JSONL event to the real stdout, flushed immediately."""
    _EVENT_STREAM.write(redact_secrets(json.dumps(event, ensure_ascii=False)) + "\n")
    _EVENT_STREAM.flush()


class DeskEventHandler(BaseCallbackHandler):
    """Emits Desk JSONL events from LangGraph node runs.

    Node-level runs are recognized by ``metadata["langgraph_node"] == run
    name`` (inner runnables inherit the metadata but keep their own names).
    ``on_chain_end`` receives the node's returned state delta, which carries
    the reports / debate turns / plans the events need.
    """

    def __init__(self, ticker: str) -> None:
        super().__init__()
        self.ticker = ticker
        self._runs: dict[str, str] = {}  # run_id -> node name
        self._phase: str | None = None
        self._last_started: str | None = None

    @staticmethod
    def _is_plumbing(node_name: str) -> bool:
        return node_name.startswith("tools_") or node_name.startswith("Msg Clear")

    def on_chain_start(
        self,
        serialized: dict[str, Any] | None,
        inputs: Any,
        *,
        run_id: Any,
        parent_run_id: Any = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        name = kwargs.get("name") or (serialized or {}).get("name")
        if not name or not metadata or metadata.get("langgraph_node") != name:
            return
        if self._is_plumbing(name):
            return
        self._runs[str(run_id)] = name

        agent = NODE_AGENTS.get(name, name)
        phase = AGENT_PHASES.get(agent)
        if phase and phase != self._phase:
            self._phase = phase
            emit({"event": "phase", "phase": phase, "ticker": self.ticker})
        # Analysts loop agent -> tools -> agent; only the first entry is a start.
        if agent != self._last_started:
            self._last_started = agent
            emit({"event": "agent", "agent": agent, "status": "start"})

    def on_chain_end(
        self,
        outputs: Any,
        *,
        run_id: Any,
        parent_run_id: Any = None,
        tags: list[str] | None = None,
        **kwargs: Any,
    ) -> None:
        name = self._runs.pop(str(run_id), None)
        if name is None:
            return
        agent = NODE_AGENTS.get(name, name)
        delta = outputs if isinstance(outputs, dict) else {}

        if agent in ANALYST_REPORT_KEYS:
            report = delta.get(ANALYST_REPORT_KEYS[agent]) or ""
            if not report:
                return  # intermediate tool-call turn; the node runs again
            emit({"event": "memo", "agent": agent, "text": report})
        elif agent in ("bull", "bear"):
            state = delta.get("investment_debate_state") or {}
            count = int(state.get("count") or 0)
            self._emit_debate(agent, (count + 1) // 2, state.get("current_response") or "")
        elif agent in RISK_RESPONSE_KEYS:
            state = delta.get("risk_debate_state") or {}
            count = int(state.get("count") or 0)
            # Three speakers (risky, safe, neutral) per risk round.
            self._emit_debate(agent, (count + 2) // 3, state.get(RISK_RESPONSE_KEYS[agent]) or "")
        elif agent == "research_manager":
            emit({"event": "memo", "agent": agent, "text": delta.get("investment_plan") or ""})
        elif agent == "trader":
            emit({"event": "memo", "agent": agent, "text": delta.get("trader_investment_plan") or ""})
        elif agent == "portfolio_manager":
            emit({"event": "memo", "agent": agent, "text": delta.get("final_trade_decision") or ""})
        # Unmapped nodes still emit start/done with the raw name (TauricPlan).
        emit({"event": "agent", "agent": agent, "status": "done"})

    @staticmethod
    def _emit_debate(side: str, round_number: int, text: str) -> None:
        emit({
            "event": "debate",
            "round": max(round_number, 1),
            "side": side,
            "text": _SPEAKER_LABEL_RE.sub("", text),
        })


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is not set (empty or missing); refusing to start")
    return value


def parse_bool(value: str) -> bool:
    normalized = value.strip().lower()
    if normalized in ("true", "1", "yes", "on"):
        return True
    if normalized in ("false", "0", "no", "off"):
        return False
    raise argparse.ArgumentTypeError(f"expected true/false, got {value!r}")


def resolve_analysts(raw: str, asset_type: str) -> list[str]:
    """Validate the analyst list and return it in Tauric order."""
    requested = {a.strip().lower() for a in raw.split(",") if a.strip()}
    unknown = requested - set(TAURIC_ANALYST_ORDER)
    if unknown:
        raise ValueError(
            f"unknown analysts: {', '.join(sorted(unknown))} "
            f"(valid: {', '.join(TAURIC_ANALYST_ORDER)})"
        )
    if asset_type == "crypto":
        requested.discard("fundamentals")  # crypto drops fundamentals (TauricPlan)
    ordered = [a for a in TAURIC_ANALYST_ORDER if a in requested]
    if not ordered:
        raise ValueError("at least one analyst is required")
    return ordered


def build_config(
    depth: str,
    checkpoint: bool,
    results_dir: Path,
    memory_log_path: Path,
    data_cache_dir: Path,
) -> dict[str, Any]:
    """DEFAULT_CONFIG overridden for an OpenRouter-backed, isolated Desk run."""
    rounds = DEPTH_ROUNDS[depth]
    config = dict(DEFAULT_CONFIG)
    config["llm_provider"] = "openrouter"  # native provider; reads OPENROUTER_API_KEY
    config["backend_url"] = (
        os.environ.get("OPENROUTER_BASE_URL", "").strip() or "https://openrouter.ai/api/v1"
    )
    config["deep_think_llm"] = require_env("DESK_DEEP_MODEL")
    config["quick_think_llm"] = require_env("DESK_QUICK_MODEL")
    config["max_debate_rounds"] = rounds
    config["max_risk_discuss_rounds"] = rounds
    config["checkpoint_enabled"] = checkpoint
    # Isolation: results per run, memory + cache (sqlite checkpoints) per user.
    # Never write to ~/.tradingagents.
    config["results_dir"] = str(results_dir)
    config["memory_log_path"] = str(memory_log_path)
    config["data_cache_dir"] = str(data_cache_dir)
    return config


def serializable_final_state(final_state: dict[str, Any]) -> dict[str, Any]:
    """Curated JSON-safe finalState (drops LangChain message objects)."""
    invest = final_state.get("investment_debate_state") or {}
    risk = final_state.get("risk_debate_state") or {}
    return {
        "company_of_interest": final_state.get("company_of_interest", ""),
        "trade_date": final_state.get("trade_date", ""),
        "asset_type": final_state.get("asset_type", "stock"),
        "market_report": final_state.get("market_report", ""),
        "sentiment_report": final_state.get("sentiment_report", ""),
        "news_report": final_state.get("news_report", ""),
        "fundamentals_report": final_state.get("fundamentals_report", ""),
        "investment_debate_state": {
            "bull_history": invest.get("bull_history", ""),
            "bear_history": invest.get("bear_history", ""),
            "history": invest.get("history", ""),
            "current_response": invest.get("current_response", ""),
            "judge_decision": invest.get("judge_decision", ""),
            "count": invest.get("count", 0),
        },
        "investment_plan": final_state.get("investment_plan", ""),
        "trader_investment_plan": final_state.get("trader_investment_plan", ""),
        "risk_debate_state": {
            "aggressive_history": risk.get("aggressive_history", ""),
            "conservative_history": risk.get("conservative_history", ""),
            "neutral_history": risk.get("neutral_history", ""),
            "history": risk.get("history", ""),
            "latest_speaker": risk.get("latest_speaker", ""),
            "judge_decision": risk.get("judge_decision", ""),
            "count": risk.get("count", 0),
        },
        "final_trade_decision": final_state.get("final_trade_decision", ""),
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Project Oracle Trading Desk runner")
    parser.add_argument("--ticker", required=True, help="single ticker symbol, e.g. NVDA")
    parser.add_argument("--as-of", required=True, help="trade date, YYYY-MM-DD")
    parser.add_argument("--depth", choices=sorted(DEPTH_ROUNDS), default="standard")
    parser.add_argument(
        "--analysts",
        default=",".join(TAURIC_ANALYST_ORDER),
        help="comma-separated subset of: " + ",".join(TAURIC_ANALYST_ORDER),
    )
    parser.add_argument("--asset-type", choices=("stock", "crypto"), default="stock")
    parser.add_argument("--checkpoint", type=parse_bool, default=False)
    parser.add_argument("--out", required=True, help="path for the {signal, finalState} JSON")
    parser.add_argument("--results-dir", required=True, help="run artifact directory")
    parser.add_argument(
        "--memory-log-path",
        default=None,
        help="per-user trading_memory.md (default: sibling of results-dir)",
    )
    parser.add_argument(
        "--data-cache-dir",
        default=None,
        help="per-user cache + checkpoints sqlite (default: sibling of results-dir / cache)",
    )
    return parser.parse_args(argv)


def _main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    # Reserve real stdout for JSONL: debug pretty-print and any library chatter
    # go to stderr. Both captured pipes use UTF-8 regardless of the inherited
    # Windows code page. Wrap stderr so API keys never land in logs.
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr = _RedactingWriter(sys.stderr)
    sys.stdout = sys.stderr

    try:
        ticker = args.ticker.strip().upper()
        if not ticker:
            raise ValueError("--ticker must not be empty")
        try:
            datetime.strptime(args.as_of, "%Y-%m-%d")
        except ValueError as exc:
            raise ValueError(f"--as-of must be YYYY-MM-DD: {exc}") from exc
        analysts = resolve_analysts(args.analysts, args.asset_type)

        require_env("OPENROUTER_API_KEY")  # hard error before any graph work
        results_dir = Path(args.results_dir).resolve()
        results_dir.mkdir(parents=True, exist_ok=True)
        memory_log_path = (
            Path(args.memory_log_path).resolve()
            if args.memory_log_path
            else results_dir.parent / "trading_memory.md"
        )
        data_cache_dir = (
            Path(args.data_cache_dir).resolve()
            if args.data_cache_dir
            else results_dir.parent / "cache"
        )
        memory_log_path.parent.mkdir(parents=True, exist_ok=True)
        data_cache_dir.mkdir(parents=True, exist_ok=True)
        config = build_config(
            args.depth,
            args.checkpoint,
            results_dir,
            memory_log_path,
            data_cache_dir,
        )

        from desk_checkpoint import inspect_saved, remember, restore
        from desk_supervisor import manifest_at
        saved_settings = dict(ticker=ticker, asOf=args.as_of, depth=args.depth,
                              analysts=analysts, assetType=args.asset_type)
        manifest = manifest_at(results_dir)
        resumable = inspect_saved(results_dir.parent, saved_settings) if args.checkpoint else None
        reference = manifest.get('resume')
        if reference or resumable:
            config.update(restore(results_dir.parent, reference or resumable, saved_settings))
        if args.checkpoint:
            remember(results_dir.parent, saved_settings, config)

        handler = DeskEventHandler(ticker)
        graph = TradingAgentsGraph(selected_analysts=analysts, debug=True, config=config)
        if args.checkpoint and not resumable:
            graph.clear_checkpoint_on_success(ticker, args.as_of, args.asset_type)
        # propagate() calls get_graph_args() with no callbacks; wrap the bound
        # method so our handler rides along (same hook Tauric's CLI uses).
        original_get_graph_args = graph.propagator.get_graph_args
        graph.propagator.get_graph_args = lambda callbacks=None: original_get_graph_args(
            callbacks=[handler, *(callbacks or [])]
        )

        final_state, signal = graph.propagate(ticker, args.as_of, args.asset_type)

        if signal not in RATINGS_5_TIER and signal != RATING_REVIEW:
            signal = RATING_REVIEW  # unparseable rating is REVIEW, never Hold
        emit({"event": "decision", "signal": signal, "ticker": ticker})

        out_path = Path(args.out).resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"signal": signal, "finalState": serializable_final_state(final_state)}
        atomic_json(out_path, json.loads(redact_secrets(json.dumps(payload, ensure_ascii=False, default=str))))

        emit({"event": "done", "ticker": ticker})
        return 0
    except Exception as exc:  # noqa: BLE001 — every failure must surface as an event
        traceback.print_exc(file=sys.stderr)
        emit({"event": "error", "message": redact_secrets(str(exc))})
        return 1


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    from desk_checkpoint import graph_use
    try:
        directory = Path(args.results_dir).absolute()
        with graph_use(directory.parent, args.ticker.strip().upper(), directory):
            return _main(argv)
    except Exception:
        emit({'event': 'error', 'message': 'Desk checkpoint ownership or state unavailable; refresh before retrying.'})
        return 1


if __name__ == "__main__":
    sys.exit(main())
