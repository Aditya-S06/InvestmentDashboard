import 'server-only';

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { computeRealizedPnl } from '@/lib/journal/service';
import { writeBrokerAudit } from './audit';

function toNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === 'number' ? value : Number(value.toFixed());
}

function journalSide(orderSide: string): 'LONG' | 'SHORT' {
  return orderSide === 'SHORT' ? 'SHORT' : 'LONG';
}

type OrderRow = {
  id: string;
  userId: string;
  environment: string;
  clientOrderId: string;
  symbol: string;
  side: string;
  qty: Prisma.Decimal;
  filledQty: Prisma.Decimal;
  avgFillPrice: Prisma.Decimal | null;
  fees: Prisma.Decimal;
  thesis: string | null;
  invalidation: string | null;
  preNotes: string | null;
  setupTag: string | null;
  strategyTag: string | null;
  source: string;
  personalTradeId: string | null;
};

/** Live / prod fills only. Sandbox never writes PersonalTrade. */
export async function syncLiveFill(order: OrderRow) {
  if (order.environment !== 'prod') return null;
  const filledQty = toNumber(order.filledQty);
  const avg = toNumber(order.avgFillPrice);
  if (!(filledQty > 0) || !(avg > 0)) return null;

  const existing = order.personalTradeId
    ? await prisma.personalTrade.findFirst({ where: { id: order.personalTradeId, userId: order.userId } })
    : await prisma.personalTrade.findFirst({
        where: { userId: order.userId, webullClientOrderId: order.clientOrderId },
      });

  const fillNote = `Webull fill ${filledQty} @ ${avg} (${order.clientOrderId})`;
  const side = journalSide(order.side);

  if (!existing && (order.side === 'BUY' || order.side === 'SHORT')) {
    const trade = await prisma.personalTrade.create({
      data: {
        userId: order.userId,
        symbol: order.symbol,
        side,
        status: 'OPEN',
        broker: 'webull',
        thesis: order.thesis,
        invalidation: order.invalidation,
        entryPrice: new Prisma.Decimal(avg),
        qty: new Prisma.Decimal(filledQty),
        openedAt: new Date(),
        fees: order.fees,
        setupTag: order.setupTag,
        strategyTag: order.strategyTag,
        preNotes: order.preNotes,
        managementNotes: fillNote,
        source: order.source || 'webull',
        webullClientOrderId: order.clientOrderId,
        brokerOrderId: order.id,
      },
    });
    await prisma.personalTradeFill.create({
      data: {
        tradeId: trade.id,
        qty: new Prisma.Decimal(filledQty),
        price: new Prisma.Decimal(avg),
        filledAt: new Date(),
        note: fillNote,
      },
    });
    await prisma.brokerOrder.update({
      where: { id: order.id },
      data: { personalTradeId: trade.id },
    });
    await writeBrokerAudit({
      userId: order.userId,
      action: 'sync',
      clientOrderId: order.clientOrderId,
      result: { personalTradeId: trade.id, filledQty },
    });
    return trade;
  }

  if (!existing) return null;

  const prevQty = toNumber(existing.qty);
  const prevEntry = toNumber(existing.entryPrice);

  if (order.side === 'BUY' && existing.side === 'LONG' && existing.status === 'OPEN') {
    const added = Math.max(0, filledQty - prevQty);
    const nextQty = Math.max(filledQty, prevQty);
    const vwap = nextQty > 0 ? (prevEntry * prevQty + avg * (added || filledQty)) / nextQty : avg;
    const trade = await prisma.personalTrade.update({
      where: { id: existing.id },
      data: {
        qty: new Prisma.Decimal(nextQty),
        entryPrice: new Prisma.Decimal(vwap),
        managementNotes: [existing.managementNotes, fillNote].filter(Boolean).join('\n'),
        brokerOrderId: order.id,
      },
    });
    await prisma.personalTradeFill.create({
      data: {
        tradeId: trade.id,
        qty: new Prisma.Decimal(added || filledQty),
        price: new Prisma.Decimal(avg),
        filledAt: new Date(),
        note: fillNote,
      },
    }).catch(() => undefined);
    return trade;
  }

  if (order.side === 'SELL' && existing.side === 'LONG' && existing.status === 'OPEN') {
    if (filledQty + 1e-9 >= prevQty) {
      const realized = computeRealizedPnl({
        side: 'LONG',
        qty: prevQty,
        entryPrice: prevEntry,
        exitPrice: avg,
        fees: toNumber(existing.fees) + toNumber(order.fees),
      });
      const trade = await prisma.personalTrade.update({
        where: { id: existing.id },
        data: {
          status: 'CLOSED',
          exitPrice: new Prisma.Decimal(avg),
          closedAt: new Date(),
          realizedPnl: realized,
          managementNotes: [existing.managementNotes, fillNote].filter(Boolean).join('\n'),
        },
      });
      return trade;
    }
    const remaining = prevQty - filledQty;
    const trade = await prisma.personalTrade.update({
      where: { id: existing.id },
      data: {
        qty: new Prisma.Decimal(remaining),
        managementNotes: [existing.managementNotes, `${fillNote}; remaining ${remaining}`].filter(Boolean).join('\n'),
      },
    });
    return trade;
  }

  if (order.side === 'BUY' && existing.side === 'SHORT' && existing.status === 'OPEN') {
    const realized = computeRealizedPnl({
      side: 'SHORT',
      qty: Math.min(filledQty, prevQty),
      entryPrice: prevEntry,
      exitPrice: avg,
      fees: toNumber(order.fees),
    });
    const remaining = prevQty - filledQty;
    if (remaining <= 1e-9) {
      return prisma.personalTrade.update({
        where: { id: existing.id },
        data: {
          status: 'CLOSED',
          exitPrice: new Prisma.Decimal(avg),
          closedAt: new Date(),
          realizedPnl: realized,
          managementNotes: [existing.managementNotes, fillNote].filter(Boolean).join('\n'),
        },
      });
    }
    return prisma.personalTrade.update({
      where: { id: existing.id },
      data: {
        qty: new Prisma.Decimal(remaining),
        managementNotes: [existing.managementNotes, fillNote].filter(Boolean).join('\n'),
      },
    });
  }

  return existing;
}
