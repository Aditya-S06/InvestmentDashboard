import { expect, it, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => ({ sub: 'operator' })) }));
import middleware from '@/middleware';
import { contentSecurityPolicy } from './csp';
afterEach(() => vi.unstubAllEnvs());
it('sets fresh request nonces and report-only responses without script unsafe-inline', async () => {
  vi.stubEnv('CSP_ENFORCE', 'false');
  const first = await middleware(new NextRequest('http://localhost:3000/dashboard'));
  const second = await middleware(new NextRequest('http://localhost:3000/dashboard'));
  const policy = first.headers.get('content-security-policy-report-only')!;
  expect(policy).toContain("'nonce-");
  expect(policy).not.toBe(second.headers.get('content-security-policy-report-only'));
  expect(first.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
  expect(first.headers.get('content-security-policy')).toBeNull();
  expect(policy.split(';').find(p => p.trim().startsWith('script-src'))).not.toContain('unsafe-inline');
});
it('supports enforcement and excludes unsafe-eval from the production policy', async () => {
  vi.stubEnv('CSP_ENFORCE', 'true');
  const response = await middleware(new NextRequest('http://localhost:3000/login'));
  expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  expect(response.headers.get('content-security-policy-report-only')).toBeNull();
  expect(contentSecurityPolicy('nonce', false)).not.toContain('unsafe-eval');
});
