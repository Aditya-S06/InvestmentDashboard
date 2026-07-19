export const dynamic = 'force-dynamic';

import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  optionalString,
  paperError,
  paperJson,
  readJsonObject,
  requiredString,
  requirePaperUser,
  stringArray,
} from '@/lib/paper/http';
import {
  assertRiskWithinLimit,
  calculateTradeRisk,
  positiveDecimal,
  riskPercent,
  validateStop,
} from '@/lib/paper/math';
import { getPaperQuote, normalizeUsEquitySymbol } from '@/lib/paper/market';
import { getBookEquityForUser } from '@/lib/paper/service';
import type { PaperSide } from '@/lib/paper/types';

interface RouteContext {
  params: { id: string };
}

function jsonValue(value: unknown, field: string): Prisma.InputJsonValue | Prisma.NullTypes.DbNull {
  if (value == null) return Prisma.DbNull;
  try {
    JSON.stringify(value);
    return value as Prisma.InputJsonValue;
  } catch {
    throw new Error(`${field} must be valid JSON`);
  }
}

export async function GET(_request: Request, { params }: RouteContext) {
  const userId = await requirePaperUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const trade = await prisma.paperTrade.findFirst({
      where: { id: params.id, userId },
      include: { fills: { orderBy: [{ filledAt: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    return paperJson(trade);
  } catch (error) {
    return paperError(error);
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const userId = await requirePaperUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const body = await readJsonObject(request);
    const trade = await prisma.paperTrade.findFirst({
      where: { id: params.id, userId },
      include: { account: true, fills: { select: { id: true } } },
    });
    if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });

    const data: Prisma.PaperTradeUncheckedUpdateInput = {};
    const requestedStatus = body.status == null ? undefined : String(body.status).toUpperCase();
    if (requestedStatus && requestedStatus !== trade.status) {
      if (requestedStatus !== 'CANCELLED' || trade.status !== 'PLANNED' || trade.fills.length > 0) {
        throw new Error('Only an unfilled planned trade can be cancelled');
      }
      data.status = 'CANCELLED';
    }

    if (trade.status === 'PLANNED') {
      const side = (body.side == null ? trade.side : String(body.side).toUpperCase()) as PaperSide;
      if (side !== 'LONG' && side !== 'SHORT') throw new Error('side must be LONG or SHORT');
      const symbol =
        body.symbol == null ? trade.symbol : normalizeUsEquitySymbol(body.symbol);
      if (symbol !== trade.symbol) await getPaperQuote(symbol);
      const plannedEntry =
        body.plannedEntry === null
          ? null
          : body.plannedEntry === undefined
            ? trade.plannedEntry
            : positiveDecimal(body.plannedEntry as string, 'plannedEntry');
      const plannedStop =
        body.plannedStop === null
          ? trade.stop
          : body.plannedStop === undefined
            ? trade.plannedStop
            : positiveDecimal(body.plannedStop as string, 'plannedStop');
      const stop =
        body.stop === undefined ? trade.stop : positiveDecimal(body.stop as string, 'stop');
      const plannedShares =
        body.plannedShares === null
          ? null
          : body.plannedShares === undefined
            ? trade.plannedShares
            : positiveDecimal(body.plannedShares as string, 'plannedShares');
      if (plannedEntry && plannedStop) validateStop(plannedEntry, plannedStop, side);

      let plannedRisk: Prisma.Decimal | null = null;
      let plannedRiskPct: Prisma.Decimal | null = null;
      if (plannedEntry && plannedStop && plannedShares) {
        const equity = await getBookEquityForUser(userId);
        plannedRisk = calculateTradeRisk(plannedEntry, plannedStop, plannedShares, side);
        assertRiskWithinLimit(plannedRisk, equity);
        plannedRiskPct = riskPercent(plannedRisk, equity);
        if (side === 'LONG' && plannedEntry.mul(plannedShares).gt(trade.account.cash)) {
          throw new Error('Planned long entry exceeds available cash');
        }
      }

      data.symbol = symbol;
      data.side = side;
      data.thesis =
        body.thesis === undefined ? trade.thesis : requiredString(body.thesis, 'thesis');
      data.invalidation =
        body.invalidation === undefined
          ? trade.invalidation
          : requiredString(body.invalidation, 'invalidation');
      data.plannedEntry = plannedEntry;
      data.plannedStop = plannedStop;
      data.plannedShares = plannedShares;
      data.plannedTarget =
        body.plannedTarget === null
          ? null
          : body.plannedTarget === undefined
            ? trade.plannedTarget
            : positiveDecimal(body.plannedTarget as string, 'plannedTarget');
      data.plannedRisk = plannedRisk;
      data.plannedRiskPct = plannedRiskPct;
      data.stop = stop;
      data.target =
        body.target === null
          ? null
          : body.target === undefined
            ? trade.target
            : positiveDecimal(body.target as string, 'target');
      if (body.setupTag !== undefined) data.setupTag = optionalString(body.setupTag, 'setupTag', 100) || null;
      if (body.strategyTag !== undefined) {
        data.strategyTag = optionalString(body.strategyTag, 'strategyTag', 100) || null;
      }
      if (body.preNotes !== undefined) data.preNotes = optionalString(body.preNotes, 'preNotes') || null;
      if (body.regimeSnapshot !== undefined) data.regimeSnapshot = jsonValue(body.regimeSnapshot, 'regimeSnapshot');
      if (body.quantSnapshot !== undefined) data.quantSnapshot = jsonValue(body.quantSnapshot, 'quantSnapshot');
    } else if (trade.status === 'OPEN') {
      if (body.stop !== undefined) {
        if (!trade.avgEntry) throw new Error('Open trade is missing average entry');
        const stop = positiveDecimal(body.stop as string, 'stop');
        validateStop(trade.avgEntry, stop, trade.side);
        const risk = calculateTradeRisk(trade.avgEntry, stop, trade.qty, trade.side);
        assertRiskWithinLimit(risk, await getBookEquityForUser(userId));
        data.stop = stop;
      }
      if (body.target !== undefined) {
        data.target = body.target === null ? null : positiveDecimal(body.target as string, 'target');
      }
    }

    if (body.insightMessageId !== undefined) {
      const insightMessageId = optionalString(body.insightMessageId, 'insightMessageId', 64) || null;
      if (insightMessageId) {
        const accessible = await prisma.insightMessage.findFirst({
          where: { id: insightMessageId, session: { userId } },
          select: { id: true },
        });
        if (!accessible) throw new Error('insightMessageId is not accessible');
      }
      data.insightMessageId = insightMessageId;
    }
    if (body.planFollowed !== undefined) {
      if (body.planFollowed !== null && typeof body.planFollowed !== 'boolean') {
        throw new Error('planFollowed must be a boolean');
      }
      data.planFollowed = body.planFollowed as boolean | null;
    }
    if (body.emotionTags !== undefined) data.emotionTags = stringArray(body.emotionTags, 'emotionTags') ?? [];
    if (body.mistakeTags !== undefined) data.mistakeTags = stringArray(body.mistakeTags, 'mistakeTags') ?? [];
    if (body.rating !== undefined) {
      const rating = body.rating === null ? null : Number(body.rating);
      if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
        throw new Error('rating must be an integer from 1 to 5');
      }
      data.rating = rating;
    }
    if (body.managementNotes !== undefined) {
      data.managementNotes = optionalString(body.managementNotes, 'managementNotes') || null;
    }
    if (body.postNotes !== undefined) data.postNotes = optionalString(body.postNotes, 'postNotes') || null;

    await prisma.paperTrade.updateMany({ where: { id: trade.id, userId }, data });
    const updated = await prisma.paperTrade.findFirst({
      where: { id: trade.id, userId },
      include: { fills: { orderBy: [{ filledAt: 'asc' }, { createdAt: 'asc' }] } },
    });
    return paperJson(updated);
  } catch (error) {
    return paperError(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const userId = await requirePaperUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const trade = await prisma.paperTrade.findFirst({
      where: { id: params.id, userId },
      select: { id: true, status: true, _count: { select: { fills: true } } },
    });
    if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    if ((trade.status !== 'PLANNED' && trade.status !== 'CANCELLED') || trade._count.fills > 0) {
      throw new Error('Only an unfilled planned or cancelled trade can be deleted');
    }
    await prisma.paperTrade.deleteMany({ where: { id: trade.id, userId } });
    return paperJson({ success: true });
  } catch (error) {
    return paperError(error);
  }
}
