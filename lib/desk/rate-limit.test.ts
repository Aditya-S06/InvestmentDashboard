import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { consumeDeskRateLimit, DESK_RATE_BUCKET, resetDeskRateLimitsForTests } from '@/lib/desk/rate-limit';

describe('consumeDeskRateLimit', () => {
  const previous = process.env.DESK_RATE_LIMIT_PER_HOUR;

  beforeEach(() => {
    resetDeskRateLimitsForTests();
    process.env.DESK_RATE_LIMIT_PER_HOUR = '4';
  });

  afterEach(() => {
    resetDeskRateLimitsForTests();
    if (previous === undefined) delete process.env.DESK_RATE_LIMIT_PER_HOUR;
    else process.env.DESK_RATE_LIMIT_PER_HOUR = previous;
  });

  it('weights fast=1 standard=2 deep=3 against a default budget of 4', () => {
    const userId = 'user-weight';
    const fast = consumeDeskRateLimit(userId, 'fast');
    expect(fast.allowed).toBe(true);
    expect(fast.bucket).toBe(DESK_RATE_BUCKET);
    expect(fast.remaining).toBe(3);

    const standard = consumeDeskRateLimit(userId, 'standard');
    expect(standard.allowed).toBe(true);
    expect(standard.remaining).toBe(1);

    const deep = consumeDeskRateLimit(userId, 'deep');
    expect(deep.allowed).toBe(false);
    expect(deep.bucket).toBe('desk');
    expect(deep.remaining).toBe(1);
  });

  it('allows one deep run then a fast run, and names remaining on deny', () => {
    const userId = 'user-deep';
    const deep = consumeDeskRateLimit(userId, 'deep');
    expect(deep.allowed).toBe(true);
    expect(deep.remaining).toBe(1);

    const fast = consumeDeskRateLimit(userId, 'fast');
    expect(fast.allowed).toBe(true);
    expect(fast.remaining).toBe(0);

    const denied = consumeDeskRateLimit(userId, 'fast');
    expect(denied.allowed).toBe(false);
    expect(denied.bucket).toBe('desk');
    expect(denied.remaining).toBe(0);
  });

  it('keeps users in separate buckets', () => {
    expect(consumeDeskRateLimit('a', 'deep').allowed).toBe(true);
    expect(consumeDeskRateLimit('b', 'deep').allowed).toBe(true);
  });
});
