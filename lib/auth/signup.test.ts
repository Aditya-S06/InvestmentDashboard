import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const userCreate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { create: (...args: unknown[]) => userCreate(...args) } },
}));

const { POST } = await import('@/app/api/signup/route');

const PASSWORD = 'twelve-chars-min';

function signupRequest(body: unknown) {
  return new NextRequest('http://localhost:3000/api/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ALLOW_PUBLIC_SIGNUP;
});

describe('POST /api/signup', () => {
  it('returns 403 when public signup is disabled', async () => {
    const res = await POST(signupRequest({ email: 'a@example.com', password: PASSWORD }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Registration is disabled on this instance' });
    expect(userCreate).not.toHaveBeenCalled();
  });

  it('hashes the password and creates the user when signup is enabled', async () => {
    process.env.ALLOW_PUBLIC_SIGNUP = 'true';
    userCreate.mockResolvedValue({ id: 'user-1', email: 'new@example.com', name: 'new' });

    const res = await POST(signupRequest({ email: 'New@Example.com', password: PASSWORD }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'user-1', email: 'new@example.com', name: 'new' });

    expect(userCreate).toHaveBeenCalledOnce();
    const hashed = userCreate.mock.calls[0][0].data.password as string;
    expect(hashed).not.toBe(PASSWORD);
    await expect(bcrypt.compare(PASSWORD, hashed)).resolves.toBe(true);
    expect(userCreate.mock.calls[0][0].data.email).toBe('new@example.com');
  });

  it('does not leak existence when the email is already taken', async () => {
    process.env.ALLOW_PUBLIC_SIGNUP = 'true';
    userCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`email`)', {
        code: 'P2002',
        clientVersion: '6.7.0',
        meta: { target: ['email'] },
      }),
    );

    const res = await POST(signupRequest({ email: 'taken@example.com', password: PASSWORD }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(res.status).not.toBe(409);
    expect(body).toEqual({ error: 'Could not create the account' });
    expect(JSON.stringify(body).toLowerCase()).not.toMatch(/exist|already|taken/);
  });
});
