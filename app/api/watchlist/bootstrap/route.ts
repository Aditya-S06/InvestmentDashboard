export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/require-user';
import { serverError } from '@/lib/http/errors';
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
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

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
  } catch (error) {
    return serverError('watchlist/bootstrap', error, 'Could not load the starter watchlist');
  }
}
