/**
 * Copy this file to context-builder.ts and implement dashboard context assembly.
 * context-builder.ts is gitignored and never committed.
 */
import 'server-only';

import { prisma } from '@/lib/prisma';
import type { InsightContext } from './types';

export async function buildInsightContext(userId: string): Promise<InsightContext> {
  // TODO: load watchlist, macro snapshot, and ticker summaries for the agent
  const watchlist = await prisma.watchlist.findMany({
    where: { userId },
    orderBy: [{ sector: 'asc' }, { ticker: 'asc' }],
  });

  return {
    watchlist: watchlist.map((item) => ({
      id: item.id,
      ticker: item.ticker,
      sector: item.sector,
      createdAt: item.createdAt.toISOString(),
    })),
    groupedWatchlist: [],
    macro: null,
    watchlistSnapshot: [],
  };
}
