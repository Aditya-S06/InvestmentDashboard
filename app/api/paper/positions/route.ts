export const dynamic = 'force-dynamic';

import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paperError, paperJson, requirePaperUser } from '@/lib/paper/http';
import { calculateMarkedEquity, calculateTradeRisk, calculateUnrealizedPnl } from '@/lib/paper/math';
import { getPaperQuotes, type PaperQuote } from '@/lib/paper/market';
import { getOrCreatePaperAccount } from '@/lib/paper/service';

export async function GET() {
  const userId = await requirePaperUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const account = await getOrCreatePaperAccount(userId);
    const trades = await prisma.paperTrade.findMany({
      where: { userId, accountId: account.id, status: 'OPEN', qty: { gt: 0 } },
      orderBy: { openedAt: 'desc' },
    });
    const quotes = await getPaperQuotes(trades.map((trade) => trade.symbol));
    let marketDataComplete = true;
    let grossExposure = new Prisma.Decimal(0);
    let unrealizedPnlTotal = new Prisma.Decimal(0);
    let openRisk = new Prisma.Decimal(0);

    const positions = trades.map((trade) => {
      const quote = quotes[trade.symbol];
      if (trade.avgEntry) {
        openRisk = openRisk.plus(calculateTradeRisk(trade.avgEntry, trade.stop, trade.qty, trade.side));
      }
      if (!quote || 'error' in quote || !trade.avgEntry) {
        marketDataComplete = false;
        return {
          ...trade,
          mark: null,
          marketValue: null,
          unrealizedPnl: null,
          marketDataError: quote && 'error' in quote ? quote.error : 'Market data unavailable',
        };
      }
      const mark = new Prisma.Decimal((quote as PaperQuote).price);
      const marketValue = trade.qty.mul(mark);
      grossExposure = grossExposure.plus(marketValue);
      const unrealizedPnl = calculateUnrealizedPnl({
        side: trade.side,
        qty: trade.qty,
        avgEntry: trade.avgEntry,
        mark,
      });
      unrealizedPnlTotal = unrealizedPnlTotal.plus(unrealizedPnl);
      return {
        ...trade,
        mark,
        marketValue,
        unrealizedPnl,
        marketDataAsOf: quote.asOf,
        marketDataError: null,
      };
    });

    const markedEquity = marketDataComplete
      ? calculateMarkedEquity(
          account.cash,
          positions.map((position) => ({
            side: position.side,
            qty: position.qty,
            avgEntry: position.avgEntry!,
            mark: position.mark!,
          })),
        )
      : null;

    return paperJson({
      account,
      positions,
      summary: {
        cash: account.cash,
        equity: markedEquity,
        grossExposure,
        unrealizedPnl: marketDataComplete ? unrealizedPnlTotal : null,
        openRisk,
        openPositionCount: positions.length,
        marketDataComplete,
      },
    });
  } catch (error) {
    return paperError(error);
  }
}
