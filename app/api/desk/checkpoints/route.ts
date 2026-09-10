export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireDeskAccess } from '@/lib/desk/access';
import {
  clearDeskCheckpointFile,
  deskHasCheckpoint,
  listDeskCheckpointTickers,
  requireSafeDeskTicker,
} from '@/lib/desk/config';

const tickerQuery = z.string().trim().min(1).max(10);

export async function GET(req: NextRequest) {
  const auth = await requireDeskAccess();
  if (auth instanceof NextResponse) return auth;

  const requested = req.nextUrl.searchParams.get('tickers');
  const known = listDeskCheckpointTickers(auth.userId);
  if (!requested) {
    return NextResponse.json({ tickers: known });
  }

  const wanted = requested
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  const tickers = wanted.filter((ticker) => known.includes(ticker) && deskHasCheckpoint(auth.userId, ticker));
  return NextResponse.json({ tickers });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireDeskAccess();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  const parsed = z.object({ ticker: tickerQuery }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'ticker is required' }, { status: 400 });
  }

  let ticker: string;
  try {
    ticker = requireSafeDeskTicker(parsed.data.ticker);
  } catch {
    return NextResponse.json({ error: 'Invalid ticker' }, { status: 400 });
  }

  const deleted = clearDeskCheckpointFile(auth.userId, ticker);
  return NextResponse.json({ ticker, deleted });
}
