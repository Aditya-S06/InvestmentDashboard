import { prisma } from '@/lib/prisma';
import { DEFAULT_WATCHLIST_TICKERS } from '@/lib/default-watchlist';
import { sectorForTicker } from '@/lib/watchlist-sectors';

/** Ensures the starter watchlist exists for a user. Returns true if items were added. */
export async function ensureDefaultWatchlist(userId: string): Promise<boolean> {
  const count = await prisma.watchlist.count({ where: { userId } });
  if (count > 0) return false;

  await prisma.watchlist.createMany({
    data: DEFAULT_WATCHLIST_TICKERS.map((ticker) => ({
      userId,
      ticker,
      sector: sectorForTicker(ticker),
    })),
    skipDuplicates: true,
  });

  return true;
}

/** Upserts the starter watchlist tickers (safe to run multiple times). */
export async function upsertDefaultWatchlist(userId: string): Promise<number> {
  for (const ticker of DEFAULT_WATCHLIST_TICKERS) {
    const sector = sectorForTicker(ticker);
    await prisma.watchlist.upsert({
      where: { userId_ticker: { userId, ticker } },
      update: { sector },
      create: { userId, ticker, sector },
    });
  }
  return DEFAULT_WATCHLIST_TICKERS.length;
}
