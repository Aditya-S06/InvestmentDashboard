import 'server-only';

import { deskRateLimitPerHour, RATE_WEIGHT } from '@/lib/desk/config';
import type { DeskDepth } from '@/lib/desk/types';

const WINDOW_MS = 60 * 60 * 1000;
const MAX_BUCKETS = 5_000;

type Bucket = { count: number; resetAt: number };

const globalForDesk = globalThis as unknown as {
  deskRateLimits?: Map<string, Bucket>;
};

const buckets = globalForDesk.deskRateLimits ?? new Map<string, Bucket>();
globalForDesk.deskRateLimits = buckets;

export const DESK_RATE_BUCKET = 'desk';

export type DeskRateLimitResult = {
  allowed: boolean;
  bucket: typeof DESK_RATE_BUCKET;
  remaining: number;
  resetAt: number;
  retryAfterSec: number;
  weight: number;
  limit: number;
};

function pruneExpired(now: number) {
  if (buckets.size < 1_000) return;
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

function evictOldestIfNeeded() {
  while (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest == null) break;
    buckets.delete(oldest);
  }
}

export function consumeDeskRateLimit(
  userId: string,
  depth: DeskDepth,
  now = Date.now(),
): DeskRateLimitResult {
  const limit = deskRateLimitPerHour();
  const weight = RATE_WEIGHT[depth];
  pruneExpired(now);
  evictOldestIfNeeded();

  const existing = buckets.get(userId);
  if (!existing || now >= existing.resetAt) {
    if (weight > limit) {
      return {
        allowed: false,
        bucket: DESK_RATE_BUCKET,
        remaining: limit,
        resetAt: now + WINDOW_MS,
        retryAfterSec: Math.ceil(WINDOW_MS / 1000),
        weight,
        limit,
      };
    }
    const resetAt = now + WINDOW_MS;
    buckets.set(userId, { count: weight, resetAt });
    return {
      allowed: true,
      bucket: DESK_RATE_BUCKET,
      remaining: Math.max(0, limit - weight),
      resetAt,
      retryAfterSec: Math.ceil(WINDOW_MS / 1000),
      weight,
      limit,
    };
  }

  const remaining = Math.max(0, limit - existing.count);
  const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  if (existing.count + weight > limit) {
    return {
      allowed: false,
      bucket: DESK_RATE_BUCKET,
      remaining,
      resetAt: existing.resetAt,
      retryAfterSec,
      weight,
      limit,
    };
  }

  existing.count += weight;
  return {
    allowed: true,
    bucket: DESK_RATE_BUCKET,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
    retryAfterSec,
    weight,
    limit,
  };
}

export function resetDeskRateLimitsForTests() {
  buckets.clear();
}
