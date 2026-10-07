"""Per-user file-operation locking for the pinned TradingAgents memory log."""
from contextlib import nullcontext

from tradingagents.agents.utils.memory import TradingMemoryLog

from desk_process import Lock, safe_path


class DeskMemoryLog(TradingMemoryLog):
    def _operation(self):
        if self._log_path is None:
            return nullcontext()
        path = safe_path(self._log_path)
        # Permanent sibling: never replace/delete this inode, including after a
        # failed update. The OS releases ownership on exception or process death.
        return Lock(path.with_name(path.name + '.lock'))

    def load_entries(self):
        with self._operation():
            return super().load_entries()

    def store_decision(self, *args, **kwargs):
        with self._operation():
            return super().store_decision(*args, **kwargs)

    def update_with_outcome(self, *args, **kwargs):
        with self._operation():
            return super().update_with_outcome(*args, **kwargs)

    def batch_update_with_outcomes(self, *args, **kwargs):
        with self._operation():
            return super().batch_update_with_outcomes(*args, **kwargs)
