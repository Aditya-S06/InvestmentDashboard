export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { groupWatchlistBySector, sectorForTicker, sectorSortIndex } from '@/lib/watchlist-sectors';
import { ensureDefaultWatchlist } from '@/lib/seed-watchlist';

function serializeWatchlistItem(i: { id: string; ticker: string; sector: string | null; createdAt: Date }) {
  return {
    id: i.id,
    ticker: i.ticker,
    sector: i.sector,
    createdAt: i.createdAt.toISOString(),
  };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    let items = await prisma.watchlist.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (items.length === 0) {
      await ensureDefaultWatchlist(userId);
      items = await prisma.watchlist.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
    }

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
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const ticker = body?.ticker?.toUpperCase?.();
    if (!ticker) return NextResponse.json({ error: 'Ticker required' }, { status: 400 });

    const sector = body?.sector?.trim() || sectorForTicker(ticker);

    const item = await prisma.watchlist.upsert({
      where: { userId_ticker: { userId, ticker } },
      update: { sector },
      create: { userId, ticker, sector },
    });
    return NextResponse.json(serializeWatchlistItem(item), { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const ticker = req.nextUrl.searchParams.get('ticker')?.toUpperCase?.();
    if (!ticker) return NextResponse.json({ error: 'Ticker required' }, { status: 400 });

    await prisma.watchlist.deleteMany({ where: { userId, ticker } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed' }, { status: 500 });
  }
}
