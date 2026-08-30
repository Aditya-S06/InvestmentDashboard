export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/require-user';
import { serverError } from '@/lib/http/errors';
import { normalizeMarketSymbol } from '@/lib/market/symbol';
import { prisma } from '@/lib/prisma';
import { groupWatchlistBySector, sectorForTicker, sectorSortIndex } from '@/lib/watchlist-sectors';

function serializeWatchlistItem(i: { id: string; ticker: string; sector: string | null; createdAt: Date }) {
  return {
    id: i.id,
    ticker: i.ticker,
    sector: i.sector,
    createdAt: i.createdAt.toISOString(),
  };
}

export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const items = await prisma.watchlist.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const serialized = items.map(serializeWatchlistItem).sort((a, b) => {
      const sectorDiff =
        sectorSortIndex(a.sector ?? sectorForTicker(a.ticker)) -
        sectorSortIndex(b.sector ?? sectorForTicker(b.ticker));
      if (sectorDiff !== 0) return sectorDiff;
      return a.ticker.localeCompare(b.ticker);
    });

    return NextResponse.json({
      items: serialized,
      sectors: groupWatchlistBySector(serialized),
    });
  } catch (error) {
    return serverError('watchlist/get', error, 'Could not load the watchlist');
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const body = await req.json();
    const ticker = normalizeMarketSymbol(body?.ticker);
    if (!ticker) return NextResponse.json({ error: 'A valid ticker is required' }, { status: 400 });

    const sector = body?.sector?.trim() || sectorForTicker(ticker);

    const item = await prisma.watchlist.upsert({
      where: { userId_ticker: { userId, ticker } },
      update: { sector },
      create: { userId, ticker, sector },
    });
    return NextResponse.json(serializeWatchlistItem(item), { status: 201 });
  } catch (error) {
    return serverError('watchlist/post', error, 'Could not add that ticker');
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const ticker = normalizeMarketSymbol(req.nextUrl.searchParams.get('ticker'));
    if (!ticker) return NextResponse.json({ error: 'A valid ticker is required' }, { status: 400 });

    await prisma.watchlist.deleteMany({ where: { userId, ticker } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return serverError('watchlist/delete', error, 'Could not remove that ticker');
  }
}
