import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import type { User } from 'next-auth';
import { consumeRateLimit } from './rate-limit';

const userFindUnique = vi.fn();

vi.mock('@/lib/identity-db', () => ({
  identityDb: { user: { findUnique: (...args: unknown[]) => userFindUnique(...args) } },
}));

const { authOptions } = await import('../auth');

const EMAIL = 'trader@example.com';
const PASSWORD = 'twelve-chars-min';

function authorize(credentials: { email?: string; password?: string } | undefined) {
  const provider = authOptions.providers[0] as {
    options?: {
      authorize?: (
        credentials: Record<string, string> | undefined,
        req: { headers?: Record<string, string> },
      ) => Promise<User | null>;
    };
  };
  const fn = provider.options?.authorize;
  if (typeof fn !== 'function') {
    throw new Error('credentials authorize is missing');
  }
  return fn(credentials as Record<string, string> | undefined, { headers: {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(consumeRateLimit).mockResolvedValue({ allowed: true, remaining: 9, retryAfterSec: 60 });
});

describe('credentials authorize', () => {
  it('fails closed before looking up a password if the shared limiter is unavailable', async () => {
    vi.mocked(consumeRateLimit).mockRejectedValue(new Error('offline'));
    await expect(authorize({ email: EMAIL, password: PASSWORD })).resolves.toBeNull();
    expect(userFindUnique).not.toHaveBeenCalled();
  });
  it('enforces the broad limit even without trusted client IP headers', async () => {
    vi.mocked(consumeRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSec: 60 });
    await expect(authorize({ email: EMAIL, password: PASSWORD })).resolves.toBeNull();
    expect(consumeRateLimit).toHaveBeenCalledWith('login-ip:unknown', 30, 900000);
    expect(userFindUnique).not.toHaveBeenCalled();
  });
  it('returns null for an unknown user', async () => {
    userFindUnique.mockResolvedValue(null);
    await expect(authorize({ email: EMAIL, password: PASSWORD })).resolves.toBeNull();
  });

  it('returns null for a bad password', async () => {
    const hash = await bcrypt.hash(PASSWORD, 4);
    userFindUnique.mockResolvedValue({
      id: 'user-1',
      email: EMAIL,
      name: 'Trader', sessionVersion: 0,
      password: hash,
    });
    await expect(authorize({ email: EMAIL, password: 'wrong-password-xx' })).resolves.toBeNull();
  });

  it('returns id and email when the bcrypt hash matches', async () => {
    const hash = await bcrypt.hash(PASSWORD, 4);
    userFindUnique.mockResolvedValue({
      id: 'user-1',
      email: EMAIL,
      name: 'Trader', sessionVersion: 0,
      password: hash,
    });
    await expect(authorize({ email: EMAIL, password: PASSWORD })).resolves.toEqual({
      id: 'user-1',
      email: EMAIL,
      name: 'Trader', sessionVersion: 0,
    });
  });
});

vi.mock('@/lib/auth/rate-limit', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/auth/rate-limit')>(), consumeRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, retryAfterSec: 60 })) }));
