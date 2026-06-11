import 'server-only';

import { INSIGHTS_RATE_LIMIT_PER_HOUR } from './config';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const globalForInsights = globalThis as unknown as {
  insightRateLimits?: Map<string, RateLimitBucket>;
};

const buckets = globalForInsights.insightRateLimits ?? new Map<string, RateLimitBucket>();

if (process.env.NODE_ENV !== 'production') {
  globalForInsights.insightRateLimits = buckets;
}

export function checkInsightRateLimit(userId: string) {
  const now = Date.now();
  const existing = buckets.get(userId);

  if (!existing || existing.resetAt <= now) {
    const next = { count: 1, resetAt: now + 60 * 60 * 1000 };
    buckets.set(userId, next);
    return { allowed: true, remaining: INSIGHTS_RATE_LIMIT_PER_HOUR - 1, resetAt: next.resetAt };
  }

  if (existing.count >= INSIGHTS_RATE_LIMIT_PER_HOUR) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, INSIGHTS_RATE_LIMIT_PER_HOUR - existing.count),
    resetAt: existing.resetAt,
  };
}

