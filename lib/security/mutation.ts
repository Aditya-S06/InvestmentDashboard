import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

/** Matches the signed double-submit cookie issued by the pinned NextAuth v4 /api/auth/csrf endpoint. */
export function validMutationRequest(request: Request): boolean {
  try {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret || !process.env.NEXTAUTH_URL) return false;
    const origin = new URL(process.env.NEXTAUTH_URL).origin;
    if (request.headers.get('origin') !== origin) return false;
    if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
    const token = request.headers.get('x-csrf-token') || '';
    if (!/^[a-f0-9]{64}$/.test(token)) return false;
    const name = `${origin.startsWith('https://') ? '__Host-' : ''}next-auth.csrf-token`;
    const cookies = (request.headers.get('cookie') || '').split(';')
      .map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
    if (cookies.length !== 1) return false;
    const value = decodeURIComponent(cookies[0].slice(name.length + 1));
    const expected = `${token}|${createHash('sha256').update(`${token}${secret}`).digest('hex')}`;
    const actualBytes = Buffer.from(value);
    const expectedBytes = Buffer.from(expected);
    return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
  } catch { return false; }
}

export function withMutationProtection<R extends Request, A extends unknown[]>(
  handler: (request: R, ...args: A) => Promise<Response>,
): (request: R, ...args: A) => Promise<Response> {
  return async (request, ...args) => {
    if (!validMutationRequest(request)) {
      return NextResponse.json({ error: 'Invalid request origin or CSRF token' }, { status: 403 });
    }
    return handler(request, ...args);
  };
}
