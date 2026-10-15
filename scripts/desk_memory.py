"""Per-user safe-path validation for the pinned TradingAgents memory log.

Upstream v0.6.0 (``tradingagents.memory.TradingMemoryLog``) serializes every
write through its own sibling lock (``trading_memory.md.lock``) and settlement
through ``trading_memory.md.settle.lock``. Desk must NOT layer its own write
lock on the same file: nested acquisition self-blocks the writer (verified on
Windows against the pinned target). This adapter therefore keeps only
safe-path validation and delegates all locking to upstream. Desk's separate
checkpoint-control/use, run-owner, and process-containment locks are untouched.
"""
import tradingagents

from tradingagents.memory import TradingMemoryLog

from desk_process import safe_path

EXPECTED_UPSTREAM_VERSION = "0.6.0"


def assert_upstream_version():
    version = getattr(tradingagents, "__version__", None)
    if version != EXPECTED_UPSTREAM_VERSION:
        raise RuntimeError(
            "Desk memory adapter pins tradingagents "
            f"{EXPECTED_UPSTREAM_VERSION}, found {version!r}"
        )


class DeskMemoryLog(TradingMemoryLog):
    def __init__(self, *args, **kwargs):
        assert_upstream_version()
        super().__init__(*args, **kwargs)

    def _checked_path(self):
        # Upstream owns locking; Desk owns path safety. Raises on symlinks.
        # The validated path is not substituted: upstream keeps its own handle.
        if self._log_path is None:
            return None
        return safe_path(self._log_path)

    def load_entries(self):
        self._checked_path()
        return super().load_entries()

    def store_decision(self, *args, **kwargs):
        # Upstream v0.6 accepts an explicit ``rating`` keyword; passthrough keeps it.
        self._checked_path()
        return super().store_decision(*args, **kwargs)

    def update_with_outcome(self, *args, **kwargs):
        self._checked_path()
        return super().update_with_outcome(*args, **kwargs)

    def batch_update_with_outcomes(self, *args, **kwargs):
        self._checked_path()
        return super().batch_update_with_outcomes(*args, **kwargs)
