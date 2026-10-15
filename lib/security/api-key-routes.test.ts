import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { CsrfRequest, installCsrfFixture } from '../../test/csrf-fixture';
import { decryptApiKey } from './api-key-crypto';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), upsert: vi.fn(), findMany: vi.fn() }));
vi.mock('@/lib/auth/require-user', () => ({ requireUser: mocks.auth }));
vi.mock('@/lib/prisma', () => ({ prisma: { apiKey: { upsert: mocks.upsert, findMany: mocks.findMany } } }));
import { GET, POST } from './api-key-routes';
beforeEach(() => {
  vi.resetAllMocks(); installCsrfFixture();
  vi.stubEnv('ADMIN_EMAILS', 'operator@example.test');
  vi.stubEnv('API_KEY_ENCRYPTION_ACTIVE_KEY_ID', 'primary');
  vi.stubEnv('API_KEY_ENCRYPTION_KEYS', JSON.stringify({ primary: Buffer.alloc(32, 1).toString('base64') }));
  mocks.auth.mockResolvedValue({ userId: 'one', email: 'one@example.test' });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function request(provider = 'openrouter') {
  return new CsrfRequest('http://localhost:3000/api/settings/apikeys', { method: 'POST', body: JSON.stringify({ provider, apiKey: 'private-test-key' }) });
}
it('stores only an encrypted value bound to the authenticated owner', async () => {
  expect((await POST(request())).status).toBe(200);
  const call = mocks.upsert.mock.calls[0][0];
  expect(JSON.stringify(call)).not.toContain('private-test-key');
  expect(call.where).toEqual({ userId_provider: { userId: 'one', provider: 'openrouter' } });
  expect(decryptApiKey(call.create.apiKey, { userId: 'one', provider: 'openrouter' })).toBe('private-test-key');
});
it('returns only metadata and never selects ciphertext for settings', async () => {
  mocks.findMany.mockResolvedValue([{ provider: 'openrouter', updatedAt: new Date(0) }]);
  expect(await (await GET()).json()).toEqual([{ provider: 'openrouter', hasKey: true, updatedAt: new Date(0).toISOString() }]);
  expect(mocks.findMany.mock.calls[0][0].select).toEqual({ provider: true, updatedAt: true });
});
it('preserves auth and admin server-key gates', async () => {
  mocks.auth.mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  expect((await POST(request())).status).toBe(401);
  mocks.auth.mockResolvedValue({ userId: 'admin', email: 'operator@example.test' });
  expect((await POST(request())).status).toBe(403);
  expect(mocks.upsert).not.toHaveBeenCalled();
});
it('does not leak key material through a database error or server logs', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.upsert.mockRejectedValue(new Error('private-test-key at private-db-host'));
  expect(await (await POST(request())).json()).toEqual({ error: 'Could not save API key' });
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-test-key|private-db-host/);
});
