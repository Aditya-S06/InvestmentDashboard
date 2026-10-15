import type { DeskDepth } from './types';

// Public UI copy; parity with scripts/desk_policy.py is covered by tests.
export const DESK_POLICY: Record<DeskDepth, { minutes: number; toolRounds: number; budgetUsd: number }> = {
  fast: { minutes: 5, toolRounds: 3, budgetUsd: .5 },
  standard: { minutes: 10, toolRounds: 5, budgetUsd: 1 },
  deep: { minutes: 15, toolRounds: 8, budgetUsd: 2 },
};
