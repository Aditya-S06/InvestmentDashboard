export const dynamic = 'force-dynamic';

// Lane: DUAL — DISPLAY slice (detail modal, trade-plan modal) + BACKEND slice
// (AI chat tool). Must split in D3 (see docs/market-data-lanes.md): the display
// slice stays licensed-only, the backend slice goes Webull-fed.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/require-user';
import { invalidSymbol, marketError } from '@/lib/market/http';
import { normalizeMarketSymbol } from '@/lib/market/symbol';
import { runPython } from '@/lib/python-runner';

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const symbol = normalizeMarketSymbol(req.nextUrl.searchParams.get('symbol'));
  if (!symbol) return invalidSymbol();

  try {
    const data = await runPython(['full', symbol]);
    return NextResponse.json(data);
  } catch (error) {
    return marketError('full', error);
  }
}
