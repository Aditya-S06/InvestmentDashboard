import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import type { User } from 'next-auth';

const userFindUnique = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => userFindUnique(...args) } },
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
});

describe('credentials authorize', () => {
  it('returns null for an unknown user', async () => {
    userFindUnique.mockResolvedValue(null);
    await expect(authorize({ email: EMAIL, password: PASSWORD })).resolves.toBeNull();
  });

  it('returns null for a bad password', async () => {
    const hash = await bcrypt.hash(PASSWORD, 4);
    userFindUnique.mockResolvedValue({
      id: 'user-1',
      email: EMAIL,
      name: 'Trader',
      password: hash,
    });
    await expect(authorize({ email: EMAIL, password: 'wrong-password-xx' })).resolves.toBeNull();
  });

  it('returns id and email when the bcrypt hash matches', async () => {
    const hash = await bcrypt.hash(PASSWORD, 4);
    userFindUnique.mockResolvedValue({
      id: 'user-1',
      email: EMAIL,
      name: 'Trader',
      password: hash,
    });
    await expect(authorize({ email: EMAIL, password: PASSWORD })).resolves.toEqual({
      id: 'user-1',
      email: EMAIL,
      name: 'Trader',
    });
  });
});
