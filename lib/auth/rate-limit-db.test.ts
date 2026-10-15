import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { consumeDatabaseRateLimit } from './rate-limit-db';

beforeEach(() => vi.stubEnv('NEXTAUTH_SECRET', 'test-only-rate-limit-secret'));
afterEach(() => vi.unstubAllEnvs());
it('hashes identifiers, uses bound parameters, and maps the database decision', async () => {
  const query = vi.fn().mockResolvedValue([{ count: 4, retryAfterSec: 30 }]);
  const db = { $executeRaw: vi.fn(), $queryRaw: query } as any;
  expect(await consumeDatabaseRateLimit(db, 'login:private-ip:email@example.test', 3, 60000))
    .toEqual({ allowed: false, remaining: 0, retryAfterSec: 30 });
  const [sql, ...parameters] = query.mock.calls[0];
  expect(parameters[0]).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify([sql, parameters])).not.toContain('email@example.test');
  query.mockResolvedValue([{ count: 1, retryAfterSec: 60 }]);
  expect((await consumeDatabaseRateLimit(db, 'key', 3, 60000)).remaining).toBe(2);
});
it('propagates store failure instead of falling back to memory', async () => {
  const db = { $executeRaw: vi.fn().mockRejectedValue(new Error('offline')), $queryRaw: vi.fn() } as any;
  await expect(consumeDatabaseRateLimit(db, 'key', 3, 60000)).rejects.toThrow('offline');
  expect(db.$queryRaw).not.toHaveBeenCalled();
});
