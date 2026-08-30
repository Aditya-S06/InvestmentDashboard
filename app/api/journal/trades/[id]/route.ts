export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  journalError,
  journalJson,
  optionalDate,
  optionalDecimal,
  optionalString,
  readJsonObject,
  requireJournalUser,
  stringArray,
} from '@/lib/journal/http';
import { computeRealizedPnl, getPersonalTrade, type PersonalStatus } from '@/lib/journal/service';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const userId = await requireJournalUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const { id } = await context.params;
    const trade = await getPersonalTrade(userId, id);
    return journalJson({ trade });
  } catch (error) {
    return journalError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const userId = await requireJournalUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const { id } = await context.params;
    const existing = await getPersonalTrade(userId, id);
    const body = await readJsonObject(request);

    if (existing.broker === 'webull' && (body.qty != null || body.entryPrice != null || body.avgEntry != null)) {
      const working = await prisma.brokerOrder.findFirst({
        where: {
          userId,
          personalTradeId: existing.id,
          status: { notIn: ['FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED'] },
        },
      });
      if (working) {
        throw new Error('Fill prices/qty are locked while the linked Webull order is working');
      }
    }

    const exitPrice = optionalDecimal(body.exitPrice ?? body.avgExit, 'exitPrice');
    const closedAt = optionalDate(body.closedAt ?? body.exitDate, 'closedAt');
    const fees = optionalDecimal(body.fees, 'fees');
    let status = existing.status as PersonalStatus;
    if (body.status != null) {
      status = String(body.status).toUpperCase() as PersonalStatus;
      if (status !== 'OPEN' && status !== 'CLOSED') throw new Error('status must be OPEN or CLOSED');
    } else if (exitPrice && existing.status === 'OPEN') {
      status = 'CLOSED';
    }

    const nextExit = exitPrice ?? existing.exitPrice;
    const nextFees = fees ?? existing.fees;
    let realizedPnl = optionalDecimal(body.realizedPnl, 'realizedPnl');
    if (status === 'CLOSED') {
      if (!nextExit) throw new Error('exitPrice is required to close a trade');
      if (realizedPnl == null) {
        realizedPnl = computeRealizedPnl({
          side: existing.side,
          qty: existing.qty,
          entryPrice: existing.entryPrice,
          exitPrice: nextExit,
          fees: nextFees,
        });
      }
    }

    const trade = await prisma.personalTrade.update({
      where: { id },
      data: {
        status,
        broker: optionalString(body.broker, 'broker', 40) ?? undefined,
        thesis: optionalString(body.thesis, 'thesis') ?? undefined,
        invalidation: optionalString(body.invalidation, 'invalidation') ?? undefined,
        exitPrice: status === 'CLOSED' ? nextExit : null,
        stop: optionalDecimal(body.stop ?? body.stopPrice, 'stop') ?? undefined,
        target: optionalDecimal(body.target ?? body.targetPrice, 'target') ?? undefined,
        closedAt: status === 'CLOSED' ? closedAt ?? existing.closedAt ?? new Date() : null,
        fees: fees ?? undefined,
        realizedPnl: status === 'CLOSED' ? realizedPnl : null,
        setupTag: optionalString(body.setupTag, 'setupTag', 80) ?? undefined,
        strategyTag: optionalString(body.strategyTag, 'strategyTag', 80) ?? undefined,
        planFollowed: typeof body.planFollowed === 'boolean' ? body.planFollowed : undefined,
        emotionTags: stringArray(body.emotionTags, 'emotionTags'),
        mistakeTags: stringArray(body.mistakeTags, 'mistakeTags'),
        rating: body.rating == null || body.rating === '' ? undefined : Number(body.rating),
        preNotes: optionalString(body.preNotes, 'preNotes') ?? undefined,
        managementNotes: optionalString(body.managementNotes, 'managementNotes') ?? undefined,
        postNotes: optionalString(body.postNotes, 'postNotes') ?? undefined,
      },
    });

    return journalJson({ trade });
  } catch (error) {
    return journalError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const userId = await requireJournalUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const { id } = await context.params;
    await getPersonalTrade(userId, id);
    await prisma.personalTrade.delete({ where: { id } });
    return journalJson({ ok: true });
  } catch (error) {
    return journalError(error);
  }
}
