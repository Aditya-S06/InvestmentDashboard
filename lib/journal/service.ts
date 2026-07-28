import 'server-only';

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { JournalApiError } from './http';

export type PersonalSide = 'LONG' | 'SHORT';
export type PersonalStatus = 'OPEN' | 'CLOSED';

function toNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === 'number' ? value : Number(value.toFixed());
}

/** Compute realized PnL from entry/exit when not provided. */
export function computeRealizedPnl(input: {
  side: PersonalSide;
  qty: Prisma.Decimal | number;
  entryPrice: Prisma.Decimal | number;
  exitPrice: Prisma.Decimal | number;
  fees?: Prisma.Decimal | number | null;
}): Prisma.Decimal {
  const qty = toNumber(input.qty);
  const entry = toNumber(input.entryPrice);
  const exit = toNumber(input.exitPrice);
  const fees = toNumber(input.fees);
  const gross = input.side === 'LONG' ? (exit - entry) * qty : (entry - exit) * qty;
  return new Prisma.Decimal(gross - fees);
}

export async function listPersonalTrades(userId: string, filters: {
  status?: PersonalStatus;
  side?: PersonalSide;
  symbol?: string;
  limit?: number;
  cursor?: string;
}) {
  const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
  const trades = await prisma.personalTrade.findMany({
    where: {
      userId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.side ? { side: filters.side } : {}),
      ...(filters.symbol ? { symbol: filters.symbol } : {}),
    },
    orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
  });
  const hasMore = trades.length > limit;
  const items = hasMore ? trades.slice(0, limit) : trades;
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null };
}

export async function getPersonalTrade(userId: string, id: string) {
  const trade = await prisma.personalTrade.findFirst({ where: { id, userId } });
  if (!trade) throw new JournalApiError('Trade not found', 404);
  return trade;
}

export async function buildPersonalAnalytics(userId: string) {
  const trades = await prisma.personalTrade.findMany({
    where: { userId },
    orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
  });

  const closed = trades.filter((t) => t.status === 'CLOSED');
  const open = trades.filter((t) => t.status === 'OPEN');
  const pnls = closed.map((t) => toNumber(t.realizedPnl));
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const netPnl = pnls.reduce((sum, p) => sum + p, 0);
  const grossWins = wins.reduce((sum, p) => sum + p, 0);
  const grossLosses = Math.abs(losses.reduce((sum, p) => sum + p, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const expectancy = closed.length ? netPnl / closed.length : 0;

  const byDay = new Map<string, { pnl: number; trades: number }>();
  for (const trade of closed) {
    const date = (trade.closedAt ?? trade.openedAt).toISOString().slice(0, 10);
    const row = byDay.get(date) ?? { pnl: 0, trades: 0 };
    row.pnl += toNumber(trade.realizedPnl);
    row.trades += 1;
    byDay.set(date, row);
  }

  let equity = 0;
  const equityCurve = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, row]) => {
      equity += row.pnl;
      return { date, equity, pnl: row.pnl };
    });

  const calendar = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, row]) => ({ date, pnl: row.pnl, trades: row.trades }));

  const breakdown = (keyFn: (t: (typeof closed)[number]) => string) => {
    const map = new Map<string, { trades: number; netPnl: number; wins: number }>();
    for (const trade of closed) {
      const key = keyFn(trade) || '—';
      const row = map.get(key) ?? { trades: 0, netPnl: 0, wins: 0 };
      const pnl = toNumber(trade.realizedPnl);
      row.trades += 1;
      row.netPnl += pnl;
      if (pnl > 0) row.wins += 1;
      map.set(key, row);
    }
    return [...map.entries()].map(([key, row]) => ({
      key,
      trades: row.trades,
      winRate: row.trades ? (row.wins / row.trades) * 100 : 0,
      netPnl: row.netPnl,
      avgR: 0,
      expectancy: row.trades ? row.netPnl / row.trades : 0,
    }));
  };

  return {
    summary: {
      netPnl,
      winRate,
      profitFactor: Number.isFinite(profitFactor) ? profitFactor : 99,
      expectancy,
      avgR: 0,
      planAdherencePct:
        closed.filter((t) => t.planFollowed != null).length === 0
          ? 0
          : (closed.filter((t) => t.planFollowed === true).length /
              closed.filter((t) => t.planFollowed != null).length) *
            100,
      maxDrawdown: 0,
      currentDrawdown: 0,
      totalTrades: trades.length,
      openPositions: open.length,
      closedTrades: closed.length,
    },
    equityCurve,
    calendar,
    breakdowns: {
      setup: breakdown((t) => t.setupTag ?? ''),
      strategy: breakdown((t) => t.strategyTag ?? ''),
      side: breakdown((t) => t.side),
      broker: breakdown((t) => t.broker ?? ''),
    },
  };
}
