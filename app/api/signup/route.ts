export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { isPublicSignupEnabled, MIN_PASSWORD_LENGTH } from '@/lib/auth/signup';
import {
  clientIpFromHeaders,
  consumeRateLimit,
  SIGNUP_RATE_LIMIT,
  SIGNUP_WINDOW_MS,
  signupRateLimitKey,
} from '@/lib/auth/rate-limit';
import { serverError } from '@/lib/http/errors';

const CREATE_FAILED = 'Could not create the account';

export async function POST(req: NextRequest) {
  const ip = clientIpFromHeaders(req.headers);
  const limited = consumeRateLimit(signupRateLimitKey(ip), SIGNUP_RATE_LIMIT, SIGNUP_WINDOW_MS);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
    );
  }

  if (!isPublicSignupEnabled()) {
    return NextResponse.json({ error: 'Registration is disabled on this instance' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { email: rawEmail, password, name } = body ?? {};

    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (!email || typeof password !== 'string') {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        { status: 400 },
      );
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email,
        password: hashed,
        name: typeof name === 'string' && name.trim() ? name.trim() : email.split('@')[0],
      },
    });

    return NextResponse.json({ id: user.id, email: user.email, name: user.name }, { status: 201 });
  } catch (error) {
    return serverError('signup', error, CREATE_FAILED);
  }
}
