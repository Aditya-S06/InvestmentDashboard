import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { vi } from 'vitest';

export const CSRF_TEST_SECRET = 'test-only-csrf-secret-with-enough-entropy';
export const CSRF_TEST_TOKEN = 'a'.repeat(64);
export function installCsrfFixture() {
  vi.stubEnv('NEXTAUTH_SECRET', CSRF_TEST_SECRET);
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
}
export function csrfHeaders(): Record<string, string> {
  return {
    origin: 'http://localhost:3000',
    'x-csrf-token': CSRF_TEST_TOKEN,
    cookie: `next-auth.csrf-token=${encodeURIComponent(`${CSRF_TEST_TOKEN}|${createHash('sha256').update(CSRF_TEST_TOKEN + CSRF_TEST_SECRET).digest('hex')}`)}`,
  };
}
/** Existing domain/ownership tests now exercise the real CSRF gate with a valid browser request. */
export class CsrfRequest extends NextRequest {
  constructor(input: ConstructorParameters<typeof NextRequest>[0], init?: ConstructorParameters<typeof NextRequest>[1]) {
    const headers = new Headers(csrfHeaders());
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    super(input, { ...init, headers });
  }
}
