import 'server-only';

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  applyFill,
  assertRiskWithinLimit,
  calculateRMultiple,
  calculateTradeRisk,
  positiveDecimal,
  toDecimal,
} from './math';
import { calculateHistoricalExcursion } from './market';
import { PaperApiError } from './http';
import type { FillSide, FillType } from './types';

const DEFAULT_EQUITY = new Prisma.Decimal(100000);

export async function getOrCreatePaperAccount(userId: string) {
  return prisma.paperAccount.upsert({
    where: { userId },
    update: {},
    create: { userId, startingEquity: DEFAULT_EQUITY, cash: DEFAULT_EQUITY, currency: 'USD' },
  });
}

export async function updatePaperAccount(
  userId: string,
  input: { startingEquity?: unknown; currency?: unknown },
) {
  const currency = input.currency == null ? undefined : String(input.currency).trim().toUpperCase();
  if (currency && currency !== 'USD') throw new PaperApiError('Paper accounts support USD only');
  const requestedEquity =
    input.startingEquity == null ? undefined : positiveDecimal(input.startingEquity as string, 'startingEquity');
  if (requestedEquity?.gt(1_000_000_000)) throw new PaperApiError('startingEquity is too large');

  return prisma.$transaction(async (tx) => {
    let account = await tx.paperAccount.findUnique({ where: { userId } });
    if (!account) {
      const initial = requestedEquity ?? DEFAULT_EQUITY;
      return tx.paperAccount.create({
        data: { userId, startingEquity: initial, cash: initial, currency: 'USD' },
      });
    }

    if (!requestedEquity && !currency) return account;
    const cash = requestedEquity ? account.cash.plus(requestedEquity.minus(account.startingEquity)) : account.cash;
    account = await tx.paperAccount.update({
      where: { userId },
      data: {
        ...(requestedEquity ? { startingEquity: requestedEquity, cash } : {}),
        ...(currency ? { currency } : {}),
      },
    });
    return account;
  });
}

export async function resetPaperAccount(userId: string, startingEquityValue?: unknown) {
  const startingEquity =
    startingEquityValue == null
      ? undefined
      : positiveDecimal(startingEquityValue as string, 'startingEquity');
  if (startingEquity?.gt(1_000_000_000)) throw new PaperApiError('startingEquity is too large');

  return prisma.$transaction(async (tx) => {
    const current = await tx.paperAccount.findUnique({ where: { userId } });
    const equity = startingEquity ?? current?.startingEquity ?? DEFAULT_EQUITY;
    if (current) {
      await tx.paperTrade.deleteMany({ where: { userId, accountId: current.id } });
      await tx.journalReview.deleteMany({ where: { userId, accountId: current.id } });
      return tx.paperAccount.update({
        where: { id: current.id },
        data: { startingEquity: equity, cash: equity, currency: 'USD' },
      });
    }
    return tx.paperAccount.create({
      data: { userId, startingEquity: equity, cash: equity, currency: 'USD' },
    });
  });
}

async function bookEquity(
  tx: Prisma.TransactionClient,
  userId: string,
  account: { id: string; cash: Prisma.Decimal },
): Promise<Prisma.Decimal> {
  const positions = await tx.paperTrade.findMany({
    where: { userId, accountId: account.id, status: 'OPEN' },
    select: { side: true, qty: true, avgEntry: true },
  });
  return positions.reduce((equity, trade) => {
    if (!trade.avgEntry) return equity;
    const value = trade.qty.mul(trade.avgEntry);
    return trade.side === 'LONG' ? equity.plus(value) : equity.minus(value);
  }, account.cash);
}

export async function getBookEquityForUser(userId: string): Promise<Prisma.Decimal> {
  const account = await getOrCreatePaperAccount(userId);
  const positions = await prisma.paperTrade.findMany({
    where: { userId, accountId: account.id, status: 'OPEN' },
    select: { side: true, qty: true, avgEntry: true },
  });
  return positions.reduce((equity, trade) => {
    if (!trade.avgEntry) return equity;
    const value = trade.qty.mul(trade.avgEntry);
    return trade.side === 'LONG' ? equity.plus(value) : equity.minus(value);
  }, account.cash);
}

export interface ExecuteFillInput {
  side: FillSide;
  type: FillType;
  qty: unknown;
  price: unknown;
  fee?: unknown;
  filledAt?: Date;
  note?: string;
}

export async function executePaperFill(userId: string, tradeId: string, input: ExecuteFillInput) {
  const qty = positiveDecimal(input.qty as string, 'qty');
  const price = positiveDecimal(input.price as string, 'price');
  const fee = input.fee == null ? new Prisma.Decimal(0) : toDecimal(input.fee as string, 'fee');
  const filledAt = input.filledAt ?? new Date();
  if (fee.lt(0)) throw new PaperApiError('fee cannot be negative');
  if (filledAt.getTime() > Date.now() + 60_000) throw new PaperApiError('filledAt cannot be in the future');

  return prisma.$transaction(
    async (tx) => {
      const trade = await tx.paperTrade.findFirst({
        where: { id: tradeId, userId },
        include: {
          account: true,
          fills: { orderBy: [{ filledAt: 'asc' }, { createdAt: 'asc' }] },
        },
      });
      if (!trade) throw new PaperApiError('Trade not found', 404);
      if (!trade.thesis.trim() || !trade.invalidation.trim() || !trade.stop) {
        throw new PaperApiError('Thesis, invalidation, and stop are required before opening');
      }
      const latestFill = trade.fills.at(-1);
      if (latestFill && filledAt < latestFill.filledAt) {
        throw new PaperApiError('Fills must be recorded in chronological order');
      }

      const closedQty = trade.fills
        .filter((fill) => fill.type === 'REDUCE' || fill.type === 'EXIT')
        .reduce((sum, fill) => sum.plus(fill.qty), new Prisma.Decimal(0));
      const result = applyFill(
        {
          side: trade.side,
          status: trade.status,
          qty: trade.qty,
          avgEntry: trade.avgEntry,
          avgExit: trade.avgExit,
          closedQty,
          realizedPnl: trade.realizedPnl,
          fees: trade.fees,
          cash: trade.account.cash,
        },
        { side: input.side, type: input.type, qty, price, fee },
      );

      const opening = input.type === 'ENTRY' || input.type === 'ADD';
      if (opening) {
        if (!result.avgEntry) throw new PaperApiError('Average entry could not be calculated');
        const equity = await bookEquity(tx, userId, trade.account);
        const risk = calculateTradeRisk(result.avgEntry, trade.stop, result.qty, trade.side);
        assertRiskWithinLimit(risk, equity);
        if (trade.side === 'LONG' && result.cash.lt(0)) {
          throw new PaperApiError('Long entry requires enough available cash');
        }
      }

      const initialRisk =
        trade.plannedRisk ??
        (trade.plannedEntry && trade.plannedStop && trade.plannedShares
          ? calculateTradeRisk(trade.plannedEntry, trade.plannedStop, trade.plannedShares, trade.side)
          : null);
      const realizedR =
        result.status === 'CLOSED' && initialRisk
          ? calculateRMultiple(result.realizedPnl, initialRisk)
          : trade.realizedR;

      await tx.paperTradeFill.create({
        data: {
          tradeId: trade.id,
          side: input.side,
          type: input.type,
          qty,
          price,
          fee,
          filledAt,
          note: input.note,
        },
      });
      await tx.paperAccount.update({
        where: { id: trade.accountId },
        data: { cash: result.cash },
      });
      await tx.paperTrade.update({
        where: { id: trade.id },
        data: {
          qty: result.qty,
          avgEntry: result.avgEntry,
          avgExit: result.avgExit,
          status: result.status,
          openedAt: trade.openedAt ?? (opening ? filledAt : null),
          closedAt: result.status === 'CLOSED' ? filledAt : null,
          realizedPnl: result.realizedPnl,
          realizedR,
          fees: result.fees,
        },
      });

      return tx.paperTrade.findFirstOrThrow({
        where: { id: trade.id, userId },
        include: { fills: { orderBy: [{ filledAt: 'asc' }, { createdAt: 'asc' }] } },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

function maximumOpenQuantity(
  fills: Array<{ type: string; qty: Prisma.Decimal }>,
): Prisma.Decimal {
  let current = new Prisma.Decimal(0);
  let maximum = new Prisma.Decimal(0);
  for (const fill of fills) {
    current =
      fill.type === 'ENTRY' || fill.type === 'ADD' ? current.plus(fill.qty) : current.minus(fill.qty);
    if (current.gt(maximum)) maximum = current;
  }
  return maximum;
}

export async function updateTradeExcursion(userId: string, tradeId: string) {
  const trade = await prisma.paperTrade.findFirst({
    where: { id: tradeId, userId, status: 'CLOSED' },
    include: { fills: { orderBy: [{ filledAt: 'asc' }, { createdAt: 'asc' }] } },
  });
  if (!trade?.avgEntry || !trade.openedAt || !trade.closedAt) return trade;

  const maxQty = maximumOpenQuantity(trade.fills);
  if (!maxQty.gt(0)) return trade;
  const excursion = await calculateHistoricalExcursion({
    symbol: trade.symbol,
    side: trade.side,
    entry: trade.avgEntry,
    qty: maxQty,
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    realizedPnl: trade.realizedPnl,
  });
  if (!excursion) return trade;

  await prisma.paperTrade.updateMany({
    where: { id: trade.id, userId, status: 'CLOSED' },
    data: {
      mfe: excursion.mfe,
      mae: excursion.mae,
      exitEfficiency: excursion.exitEfficiency,
    },
  });
  return prisma.paperTrade.findFirst({
    where: { id: trade.id, userId },
    include: { fills: { orderBy: [{ filledAt: 'asc' }, { createdAt: 'asc' }] } },
  });
}
