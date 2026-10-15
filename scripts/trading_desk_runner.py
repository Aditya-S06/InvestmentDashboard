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
from tradingagents.agents.rating import RATING_REVIEW, RATINGS_5_TIER  # noqa: E402
from tradingagents.default_config import DEFAULT_CONFIG  # noqa: E402
from tradingagents.graph.trading_graph import TradingAgentsGraph as _TradingAgentsGraph  # noqa: E402


class TradingAgentsGraph(_TradingAgentsGraph):
    """App-owned boundaries, installed before upstream compiles its workflow.

    Upstream v0.6.0 builds analyst ToolNodes from frozen specs with no
    per-graph tool hook, so sanitization is installed at the setup boundary
    (spec copies) plus the Sentiment direct-fetch boundary before construction.
    """
    def __init__(self, *args, **kwargs):
        self.desk_runtime = kwargs.pop('desk_runtime', None)
        from desk_memory import DeskMemoryLog
        from desk_tool_safety import (
            SafeReflector,
            assert_upstream_version,
            install_safe_plan,
            install_sentiment_safety,
        )
        assert_upstream_version()
        install_safe_plan()
        install_sentiment_safety()
        restore_clients = None
        if self.desk_runtime:
            from desk_execution import install_clients
            restore_clients, self.desk_clients = install_clients(self.desk_runtime)
        try:
            super().__init__(*args, **kwargs)
        finally:
            if restore_clients:
                restore_clients()
        self.memory_log = DeskMemoryLog(self.config)
        self.reflector = SafeReflector(self.reflector.quick_thinking_llm)

    def _memory_step(self, state):
        if self.desk_runtime:
            from desk_execution import memory_step
            return memory_step(self, state, self.desk_runtime)
        return super()._memory_step(state)

# Real stdout, captured before main() points sys.stdout at stderr. Only JSONL
# events are ever written here.
_EVENT_STREAM = sys.stdout
if hasattr(_EVENT_STREAM, "reconfigure"):
    _EVENT_STREAM.reconfigure(encoding="utf-8", errors="strict", newline="\n")

DEPTH_ROUNDS = {"fast": 1, "standard": 3, "deep": 5}

TAURIC_ANALYST_ORDER = ("market", "social", "news", "fundamentals")

# LangGraph node name -> Desk agent key (TauricPlan `agent` vocabulary).
# "Memory Log" is upstream v0.6's parallel settlement/context step; it gets the
# stable "memory" identifier so the timeline can show it beside the analysts.
NODE_AGENTS = {
    "Market Analyst": "market",
    "Sentiment Analyst": "social",
    "News Analyst": "news",
    "Fundamentals Analyst": "fundamentals",
    "Memory Log": "memory",
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
    "memory": "analysts",
    "bull": "debate",
    "bear": "debate",
    "research_manager": "research_manager",
    "trader": "trader",
    "risky": "risk",
    "safe": "risk",
    "neutral": "risk",
    "portfolio_manager": "portfolio_manager",
}

# Inner nodes of an analyst subgraph. They only ever run nested inside a
# top-level analyst run; the ancestry check below is the primary filter and
# this set is belt-and-braces so internal names never reach the timeline.
SUBGRAPH_INNER_NODES = frozenset({"agent", "tools", "wrap_up"})

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
        self._runs: dict[str, str] = {}  # top-level node run_id -> node name
        self._parents: dict[str, Any] = {}  # every chain run_id -> parent run_id
        self._active: set[str] = set()  # agents with an emitted, unclosed start
        self._phase: str | None = None

    @staticmethod
    def _is_plumbing(node_name: str) -> bool:
        return (node_name.startswith("tools_") or node_name.startswith("Msg Clear")
                or node_name in SUBGRAPH_INNER_NODES)

    def _is_top_level(self, name: str, run_id: Any, parent_run_id: Any) -> bool:
        """Top-level graph nodes only, by callback ancestry.

        Analyst subgraphs run "agent"/"tools"/"wrap_up" as children of the
        analyst node run; only a known node whose parent is not itself a
        tracked node run may emit timeline events. Parent starts always arrive
        before child starts on the same callback thread.
        """
        if name not in NODE_AGENTS:
            return False
        parent_key = str(parent_run_id) if parent_run_id is not None else None
        return parent_key is None or parent_key not in self._runs

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
        if run_id is not None:
            self._parents[str(run_id)] = parent_run_id
        if not name or not metadata or metadata.get("langgraph_node") != name:
            return
        if self._is_plumbing(name):
            return
        if not self._is_top_level(name, run_id, parent_run_id):
            return
        self._runs[str(run_id)] = name
        from desk_runtime import NODE
        NODE.set(name)

        agent = NODE_AGENTS.get(name, name)
        phase = AGENT_PHASES.get(agent)
        if phase and phase != self._phase:
            self._phase = phase
            emit({"event": "phase", "phase": phase, "ticker": self.ticker})
        # Parallel analysts interleave; track each agent independently instead
        # of assuming one global "current" starter.
        if agent not in self._active:
            self._active.add(agent)
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
            return  # nested run or filtered start; never opened a timeline span
        agent = NODE_AGENTS.get(name, name)
        delta = outputs if isinstance(outputs, dict) else {}

        if agent in ANALYST_REPORT_KEYS:
            # Top-level analyst runs end exactly once with the filed report.
            report = delta.get(ANALYST_REPORT_KEYS[agent]) or ""
            if report:
                emit({"event": "memo", "agent": agent, "text": report})
        elif agent == "memory":
            # Settlement warnings stay visible; an empty note emits no memo.
            note = delta.get("memory_note") or ""
            if note:
                emit({"event": "memo", "agent": agent, "text": note})
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
        self._active.discard(agent)
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


def check_runtime():
    """Fail before any graph/provider work on an unsupported interpreter or checkout.

    Upstream v0.6.0 requires Python >=3.11, and the adapter pins that exact
    checkout: the venv must import tradingagents from this repo's TradingAgents
    tree, never a stray site-packages copy or a drifted working tree version.
    """
    if sys.version_info < (3, 11):
        raise RuntimeError(
            f"Desk requires Python >=3.11, running {sys.version.split()[0]}")
    import tradingagents
    expected_root = _TRADINGAGENTS_DIR.resolve()
    actual_file = Path(getattr(tradingagents, "__file__", "")).resolve()
    try:
        actual_file.relative_to(expected_root)
    except ValueError:
        raise RuntimeError(
            f"Desk must import tradingagents from {expected_root}, found {actual_file}") from None
    from desk_tool_safety import assert_upstream_version
    assert_upstream_version()


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
    from desk_checkpoint import backend_url_for
    rounds = DEPTH_ROUNDS[depth]
    config = dict(DEFAULT_CONFIG)
    from desk_policy import config_policy
    config.update(config_policy(depth))
    config["llm_provider"] = "openrouter"  # native provider; reads OPENROUTER_API_KEY
    config["backend_url"] = backend_url_for(os.environ)
    # Versioned Desk bounds participate in checkpoint identity. Upstream env
    # settings must not silently override the application's cost controls.
    max_tool_rounds = config["max_tool_rounds"]
    max_recur_limit = config["max_recur_limit"]
    if not isinstance(max_tool_rounds, int) or not isinstance(max_recur_limit, int):
        raise RuntimeError("Upstream changed the tool-round/recursion config types")
    if 2 * max_tool_rounds + 2 >= max_recur_limit:
        raise RuntimeError(
            f"max_tool_rounds={max_tool_rounds} needs max_recur_limit above {2 * max_tool_rounds + 2}")
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
    """Curated JSON-safe finalState (drops LangChain message objects).

    Carries upstream v0.6's canonical ``final_rating`` and ``memory_note``
    alongside the reports. Nested ``judge_decision`` keys are kept as empty
    fallbacks: v0.6 no longer emits them, but saved pre-upgrade data still
    carries them and downstream curation accepts both shapes.
    """
    from tradingagents.agents.rating import run_rating
    invest = final_state.get("investment_debate_state") or {}
    risk = final_state.get("risk_debate_state") or {}
    return {
        "company_of_interest": final_state.get("company_of_interest", ""),
        "trade_date": final_state.get("trade_date", ""),
        "asset_type": final_state.get("asset_type", "stock"),
        "final_rating": run_rating(final_state),
        "memory_note": final_state.get("memory_note", ""),
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
        check_runtime()
        ticker = args.ticker.strip().upper()
        if not ticker:
            raise ValueError("--ticker must not be empty")
        try:
            as_of = datetime.strptime(args.as_of, "%Y-%m-%d").date()
        except ValueError as exc:
            raise ValueError(f"--as-of must be YYYY-MM-DD: {exc}") from exc
        if as_of > datetime.now().date():
            # Fail before any reservation/charge: upstream rejects future trade
            # dates early, using the same server-local date for comparison.
            raise ValueError(f"--as-of must not be in the future: {args.as_of}")
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

        from desk_checkpoint import (
            backend_url_for,
            inspect_saved,
            remember,
            restore,
            verify_thread,
        )
        from desk_supervisor import manifest_at
        saved_settings = dict(ticker=ticker, asOf=args.as_of, depth=args.depth,
                              analysts=analysts, assetType=args.asset_type)
        manifest = manifest_at(results_dir)
        live_backend_url = backend_url_for(os.environ)
        resumable = inspect_saved(results_dir.parent, saved_settings) if args.checkpoint else None
        reference = manifest.get('resume')
        if reference or resumable:
            restored = restore(results_dir.parent, reference or resumable, saved_settings)
            # Fail closed unless the live effective config reproduces the
            # reference thread: model/endpoint/vendor/limit drift refuses resume.
            verify_thread(saved_settings, restored, live_backend_url,
                          (reference or resumable)['threadId'])
            config.update(restored)
        if args.checkpoint:
            remember(results_dir.parent, saved_settings, config, live_backend_url)

        from desk_runtime import Runtime
        from desk_execution import install_data_limits
        import desk_tool_safety
        from desk_supervisor import read
        deadline = read(results_dir / 'state.json')['deadline']
        run_settings = {'quick_think_llm': config['quick_think_llm'],
                        'deep_think_llm': config['deep_think_llm'],
                        'desk_policy_version': config['desk_policy_version'],
                        'max_tool_rounds': config['max_tool_rounds']}
        runtime = Runtime(args.depth, deadline, results_dir / f'usage-{ticker}.json', run_settings)
        desk_tool_safety.RUNTIME = runtime
        restore_data = install_data_limits(runtime)
        handler = DeskEventHandler(ticker)
        graph = TradingAgentsGraph(selected_analysts=analysts, debug=True, config=config, desk_runtime=runtime)
        if args.checkpoint and not resumable:
            graph.clear_checkpoint_on_success(ticker, args.as_of, args.asset_type)
        # propagate() calls get_graph_args() with no callbacks; wrap the bound
        # method so our handler rides along (same hook Tauric's CLI uses).
        original_get_graph_args = graph.propagator.get_graph_args
        graph.propagator.get_graph_args = lambda callbacks=None: original_get_graph_args(
            callbacks=[handler, *(callbacks or [])]
        )

        try:
            final_state, signal = graph.propagate(ticker, args.as_of, args.asset_type)
            runtime.check()  # a swallowed budget exception cannot publish success
        finally:
            restore_data()
            desk_tool_safety.RUNTIME = None
            for client in graph.desk_clients:
                client.close()

        if signal not in RATINGS_5_TIER and signal != RATING_REVIEW:
            signal = RATING_REVIEW  # unparseable rating is REVIEW, never Hold
        emit({"event": "decision", "signal": signal, "ticker": ticker})

        out_path = Path(args.out).resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"signal": signal, "finalState": serializable_final_state(final_state),
                   # Upstream allowlist: endpoints, keys and local paths never recorded.
                   "runSettings": {**graph.run_settings(), **run_settings}}
        payload['finalState']['desk_usage'] = runtime.summary()
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
