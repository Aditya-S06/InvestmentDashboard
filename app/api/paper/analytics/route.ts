export const dynamic = 'force-dynamic';

import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { optionalDate, paperError, paperJson, requirePaperUser } from '@/lib/paper/http';
import { getOrCreatePaperAccount } from '@/lib/paper/service';

type ClosedTrade = Awaited<ReturnType<typeof loadClosedTrades>>[number];

async function loadClosedTrades(userId: string, from?: Date, to?: Date) {
  return prisma.paperTrade.findMany({
    where: {
      userId,
      status: 'CLOSED',
      closedAt: {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      },
    },
    orderBy: [{ closedAt: 'asc' }, { id: 'asc' }],
  });
}

function summarize(items: ClosedTrade[]) {
  const zero = new Prisma.Decimal(0);
  const netPnl = items.reduce((sum, trade) => sum.plus(trade.realizedPnl), zero);
  const grossProfit = items.reduce(
    (sum, trade) => (trade.realizedPnl.gt(0) ? sum.plus(trade.realizedPnl) : sum),
    zero,
  );
  const grossLoss = items.reduce(
    (sum, trade) => (trade.realizedPnl.lt(0) ? sum.plus(trade.realizedPnl.abs()) : sum),
    zero,
  );
  const wins = items.filter((trade) => trade.realizedPnl.gt(0)).length;
  return {
    tradeCount: items.length,
    wins,
    losses: items.filter((trade) => trade.realizedPnl.lt(0)).length,
    breakeven: items.filter((trade) => trade.realizedPnl.isZero()).length,
    winRate: items.length ? new Prisma.Decimal(wins).div(items.length).mul(100) : zero,
    netPnl,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss.isZero() ? null : grossProfit.div(grossLoss),
    expectancy: items.length ? netPnl.div(items.length) : zero,
    averageR: (() => {
      const withR = items.filter((trade) => trade.realizedR != null);
      return withR.length
        ? withR.reduce((sum, trade) => sum.plus(trade.realizedR!), zero).div(withR.length)
        : null;
    })(),
  };
}

function breakdown(items: ClosedTrade[], key: (trade: ClosedTrade) => string | null) {
  const groups = new Map<string, ClosedTrade[]>();
  for (const trade of items) {
    const label = key(trade) || 'Uncategorized';
    groups.set(label, [...(groups.get(label) ?? []), trade]);
  }
  return [...groups.entries()]
    .map(([label, trades]) => ({ label, ...summarize(trades) }))
    .sort((a, b) => b.tradeCount - a.tradeCount || a.label.localeCompare(b.label));
}

function multiBreakdown(items: ClosedTrade[], keys: (trade: ClosedTrade) => string[]) {
  const groups = new Map<string, ClosedTrade[]>();
  for (const trade of items) {
    const labels = [...new Set(keys(trade).filter(Boolean))];
    for (const label of labels.length > 0 ? labels : ['Uncategorized']) {
      groups.set(label, [...(groups.get(label) ?? []), trade]);
    }
  }
  return [...groups.entries()]
    .map(([label, trades]) => ({ label, ...summarize(trades) }))
    .sort((a, b) => b.tradeCount - a.tradeCount || a.label.localeCompare(b.label));
}

function regimeLabel(trade: ClosedTrade): string | null {
  const snapshot = trade.regimeSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const value = (snapshot as Record<string, unknown>).regime;
  return typeof value === 'string' ? value : null;
}

function holdingTimeLabel(trade: ClosedTrade): string {
  if (!trade.openedAt || !trade.closedAt) return 'Unknown';
  const hours = Math.max(0, trade.closedAt.getTime() - trade.openedAt.getTime()) / 3_600_000;
  if (hours < 24) return 'Intraday';
  if (hours < 24 * 3) return '1-3 days';
  if (hours < 24 * 10) return '3-10 days';
  if (hours < 24 * 30) return '10-30 days';
  return '30+ days';
}

export async function GET(request: Request) {
  const userId = await requirePaperUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const url = new URL(request.url);
    const from = optionalDate(url.searchParams.get('from'), 'from');
    const to = optionalDate(url.searchParams.get('to'), 'to');
    if (from && to && from > to) throw new Error('from cannot be after to');

    const [account, trades, openTradeCount] = await Promise.all([
      getOrCreatePaperAccount(userId),
      loadClosedTrades(userId, from, to),
      prisma.paperTrade.count({ where: { userId, status: 'OPEN' } }),
    ]);
    const overview = summarize(trades);
    const followed = trades.filter((trade) => trade.planFollowed === true).length;
    const graded = trades.filter((trade) => trade.planFollowed != null).length;

    const calendarMap = new Map<string, ClosedTrade[]>();
    for (const trade of trades) {
      const date = trade.closedAt!.toISOString().slice(0, 10);
      calendarMap.set(date, [...(calendarMap.get(date) ?? []), trade]);
    }
    const calendar = [...calendarMap.entries()].map(([date, dayTrades]) => ({
      date,
      ...summarize(dayTrades),
    }));

    let equity = account.startingEquity;
    let peak = equity;
    let maximumDrawdown = new Prisma.Decimal(0);
    const equityCurve = trades.map((trade) => {
      equity = equity.plus(trade.realizedPnl);
      if (equity.gt(peak)) peak = equity;
      const drawdown = peak.isZero() ? new Prisma.Decimal(0) : peak.minus(equity).div(peak).mul(100);
      if (drawdown.gt(maximumDrawdown)) maximumDrawdown = drawdown;
      return {
        tradeId: trade.id,
        date: trade.closedAt,
        equity,
        cumulativePnl: equity.minus(account.startingEquity),
        drawdownPct: drawdown,
      };
    });
    const currentDrawdownPct = equityCurve.at(-1)?.drawdownPct ?? new Prisma.Decimal(0);

    return paperJson({
      range: { from: from ?? null, to: to ?? null },
      overview: {
        ...overview,
        openTradeCount,
        fees: trades.reduce((sum, trade) => sum.plus(trade.fees), new Prisma.Decimal(0)),
        planAdherence: graded ? new Prisma.Decimal(followed).div(graded).mul(100) : null,
        maximumDrawdownPct: maximumDrawdown,
        currentDrawdownPct,
        bestTrade:
          trades.length > 0
            ? trades.reduce((best, trade) => (trade.realizedPnl.gt(best.realizedPnl) ? trade : best))
            : null,
        worstTrade:
          trades.length > 0
            ? trades.reduce((worst, trade) => (trade.realizedPnl.lt(worst.realizedPnl) ? trade : worst))
            : null,
      },
      breakdowns: {
        setup: breakdown(trades, (trade) => trade.setupTag),
        strategy: breakdown(trades, (trade) => trade.strategyTag),
        regime: breakdown(trades, regimeLabel),
        symbol: breakdown(trades, (trade) => trade.symbol),
        side: breakdown(trades, (trade) => trade.side),
        weekday: breakdown(trades, (trade) =>
          trade.closedAt?.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }) ?? null,
        ),
        holdingTime: breakdown(trades, holdingTimeLabel),
        planAdherence: breakdown(trades, (trade) =>
          trade.planFollowed == null ? 'Not reviewed' : trade.planFollowed ? 'Plan followed' : 'Plan broken',
        ),
        emotion: multiBreakdown(trades, (trade) => trade.emotionTags),
        mistake: multiBreakdown(trades, (trade) => trade.mistakeTags),
      },
      calendar,
      equityCurve,
    });
  } catch (error) {
    return paperError(error);
  }
}
