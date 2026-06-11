export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { groupWatchlistBySector, sectorForTicker, sectorSortIndex } from '@/lib/watchlist-sectors';
import { upsertDefaultWatchlist } from '@/lib/seed-watchlist';

function serializeWatchlistItem(i: { id: string; ticker: string; sector: string | null; createdAt: Date }) {
  return {
    id: i.id,
    ticker: i.ticker,
    sector: i.sector,
    createdAt: i.createdAt.toISOString(),
  };
}

/** POST — load or refresh the starter watchlist for the signed-in user. */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const added = await upsertDefaultWatchlist(userId);
    const items = await prisma.watchlist.findMany({ where: { userId } });
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
      upserted: added,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed' }, { status: 500 });
  }
}
