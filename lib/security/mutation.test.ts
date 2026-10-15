import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validMutationRequest, withMutationProtection } from './mutation';
import { csrfHeaders, installCsrfFixture } from '../../test/csrf-fixture';

beforeEach(installCsrfFixture);
afterEach(() => vi.unstubAllEnvs());
function request(overrides: Record<string, string | undefined> = {}) {
  const headers = new Headers(csrfHeaders());
  for (const [name, value] of Object.entries(overrides)) if (value !== undefined) headers.set(name, value);
  return new Request('http://localhost:3000/api/test', { method: 'POST', headers });
}
describe('mutation protection', () => {
  it('accepts the signed NextAuth token only with its exact origin', () => {
    expect(validMutationRequest(request())).toBe(true);
  });
  it.each([
    { origin: 'https://attacker.test' }, { origin: '' }, { origin: 'null' },
    { origin: 'http://sub.localhost:3000' }, { 'sec-fetch-site': 'cross-site' },
    { 'x-csrf-token': '' }, { 'x-csrf-token': 'b'.repeat(64) }, { cookie: '' },
    { cookie: 'next-auth.csrf-token=%invalid' },
    { cookie: 'next-auth.csrf-token=' + 'a'.repeat(64) + '%7C' + '0'.repeat(64) },
  ])('rejects invalid browser credentials %j', bad => expect(validMutationRequest(request(bad))).toBe(false));
  it('requires the host-prefixed cookie on HTTPS and rejects duplicates', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://desk.example.test');
    expect(validMutationRequest(request({ origin: 'https://desk.example.test' }))).toBe(false);
    const cookie = csrfHeaders().cookie.replace('next-auth.csrf-token', '__Host-next-auth.csrf-token');
    expect(validMutationRequest(request({ origin: 'https://desk.example.test', cookie }))).toBe(true);
    expect(validMutationRequest(request({ origin: 'https://desk.example.test', cookie: cookie + '; ' + cookie }))).toBe(false);
  });
  it('never invokes a mutation on rejection and forwards route context on success', async () => {
    const handler = vi.fn(async (_req: Request, ctx: { id: string }) => Response.json(ctx));
    const guarded = withMutationProtection(handler);
    expect((await guarded(request({ origin: 'https://attacker.test' }), { id: 'one' })).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
    expect(await (await guarded(request(), { id: 'one' })).json()).toEqual({ id: 'one' });
  });
});
