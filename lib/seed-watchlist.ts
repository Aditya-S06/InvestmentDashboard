import { prisma } from '@/lib/prisma';
import { ALL_SECTOR_TICKERS } from '@/lib/watchlist-sectors';

/** Ensures the default sector baskets exist for a user. Returns true if items were added. */
export async function ensureSectorWatchlist(userId: string): Promise<boolean> {
  const count = await prisma.watchlist.count({ where: { userId } });
  if (count > 0) return false;

  await prisma.watchlist.createMany({
    data: ALL_SECTOR_TICKERS.map(({ ticker, sector }) => ({
      userId,
      ticker,
      sector,
    })),
    skipDuplicates: true,
  });

  return true;
}

/** Upserts all sector basket tickers (safe to run multiple times). */
export async function upsertSectorWatchlist(userId: string): Promise<number> {
  for (const { ticker, sector } of ALL_SECTOR_TICKERS) {
    await prisma.watchlist.upsert({
      where: { userId_ticker: { userId, ticker } },
      update: { sector },
      create: { userId, ticker, sector },
    });
  }
  return ALL_SECTOR_TICKERS.length;
}
