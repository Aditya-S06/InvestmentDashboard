import 'server-only';

/** Per-process only. Multiple Node instances each have their own counters. */
export const LOGIN_RATE_LIMIT = 10;
export const LOGIN_IP_RATE_LIMIT = 30;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const SIGNUP_RATE_LIMIT = 5;
export const SIGNUP_WINDOW_MS = 15 * 60 * 1000;

const MAX_BUCKETS = 5_000;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
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

export function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  pruneExpired(now);
  evictOldestIfNeeded();
  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, retryAfterSec: Math.ceil(windowMs / 1000) };
  }
  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  existing.count += 1;
  return {
    allowed: true,
    remaining: limit - existing.count,
    retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

type HeaderBag = Headers | Record<string, string | string[] | undefined | null>;

function firstHeader(value: string | string[] | null | undefined): string | undefined {
  if (value == null) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed || undefined;
}

/** Vercel overwrites X-Forwarded-For. Self-hosted proxies must set TRUST_PROXY=true. */
export function isTrustedProxy(): boolean {
  if (process.env.VERCEL === '1') return true;
  return ['1', 'true', 'yes', 'on'].includes((process.env.TRUST_PROXY || '').trim().toLowerCase());
}

export function clientIpFromHeaders(headers: HeaderBag | undefined): string {
  if (!isTrustedProxy() || !headers) return 'unknown';
  let forwarded: string | undefined;
  let realIp: string | undefined;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    forwarded = headers.get('x-forwarded-for') ?? undefined;
    realIp = headers.get('x-real-ip') ?? headers.get('cf-connecting-ip') ?? undefined;
  } else {
    const bag = headers as Record<string, string | string[] | undefined | null>;
    forwarded = firstHeader(bag['x-forwarded-for'] ?? bag['X-Forwarded-For']);
    realIp =
      firstHeader(bag['x-real-ip'] ?? bag['X-Real-Ip']) ??
      firstHeader(bag['cf-connecting-ip'] ?? bag['CF-Connecting-IP']);
  }
  const fromForwarded = forwarded?.split(',')[0]?.trim();
  const ip = fromForwarded || realIp?.trim();
  if (!ip || ip.length > 64) return 'unknown';
  return ip;
}

export function loginRateLimitKey(ip: string, email: string): string {
  return `login:${ip}:${email.trim().toLowerCase().slice(0, 254)}`;
}

export function loginIpRateLimitKey(ip: string): string {
  return `login-ip:${ip}`;
}

export function signupRateLimitKey(ip: string): string {
  return `signup:${ip}`;
}
