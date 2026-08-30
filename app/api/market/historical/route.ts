export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/require-user';
import { invalidSymbol, marketError } from '@/lib/market/http';
import { normalizeHistoricalPeriod, normalizeMarketSymbol } from '@/lib/market/symbol';
import { runPython } from '@/lib/python-runner';

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const symbol = normalizeMarketSymbol(req.nextUrl.searchParams.get('symbol'));
  if (!symbol) return invalidSymbol();

  const period = normalizeHistoricalPeriod(req.nextUrl.searchParams.get('period'));
  if (!period) return NextResponse.json({ error: 'Unsupported period' }, { status: 400 });

  try {
    const data = await runPython(['historical', symbol, period]);
    return NextResponse.json(data);
  } catch (error) {
    return marketError('historical', error);
  }
}
