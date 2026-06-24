/**
 * Copy to rate-limit.ts and implement per-user limits.
 * rate-limit.ts is gitignored and never committed.
 */
import 'server-only';

import { INSIGHTS_RATE_LIMIT_PER_HOUR } from './config';

export function checkInsightRateLimit(userId: string) {
  void userId;
  void INSIGHTS_RATE_LIMIT_PER_HOUR;
  return { allowed: true, remaining: INSIGHTS_RATE_LIMIT_PER_HOUR - 1, resetAt: Date.now() + 60 * 60 * 1000 };
}
