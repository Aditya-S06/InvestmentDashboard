export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/require-user';
import { logServerError } from '@/lib/http/errors';
import { normalizeSearchQuery } from '@/lib/market/symbol';
import { runPython } from '@/lib/python-runner';

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const query = normalizeSearchQuery(req.nextUrl.searchParams.get('q'));
  if (!query) return NextResponse.json([]);

  try {
    const data = await runPython(['search', query]);
    return NextResponse.json(data);
  } catch (error) {
    logServerError('market/search', error);
    return NextResponse.json([]);
  }
}
