import 'server-only';
import { identityDb as prisma } from '@/lib/identity-db';
import { consumeDatabaseRateLimit } from './rate-limit-db';

export const LOGIN_RATE_LIMIT = 10;
export const LOGIN_IP_RATE_LIMIT = 30;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const SIGNUP_RATE_LIMIT = 5;
export const SIGNUP_WINDOW_MS = 15 * 60 * 1000;

export class RateLimitUnavailable extends Error {
  constructor() { super('Authentication rate limiter unavailable'); }
}

export async function consumeRateLimit(key: string, limit: number, windowMs: number) {
  try { return await consumeDatabaseRateLimit(prisma, key, limit, windowMs); }
  catch { throw new RateLimitUnavailable(); }
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
