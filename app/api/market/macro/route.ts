export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/require-user';
import { marketError } from '@/lib/market/http';
import { runPython } from '@/lib/python-runner';

export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  try {
    const data = await runPython(['macro']);
    return NextResponse.json(data);
  } catch (error) {
    return marketError('macro', error);
  }
}
