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
import { getBookEquityForUser, getOrCreatePaperAccount } from '@/lib/paper/service';
import type { PaperSide, PaperStatus } from '@/lib/paper/types';

const TRADE_STATUSES = new Set<PaperStatus>(['PLANNED', 'OPEN', 'CLOSED', 'CANCELLED']);
const TRADE_SIDES = new Set<PaperSide>(['LONG', 'SHORT']);

function jsonValue(value: unknown, field: string): Prisma.InputJsonValue | undefined {
  if (value == null) return undefined;
  try {
    JSON.stringify(value);
    return value as Prisma.InputJsonValue;
  } catch {
    throw new Error(`${field} must be valid JSON`);
  }
}

export async function GET(request: Request) {
  const userId = await requirePaperUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const url = new URL(request.url);
    const statusValue = url.searchParams.get('status')?.toUpperCase() as PaperStatus | undefined;
    const sideValue = url.searchParams.get('side')?.toUpperCase() as PaperSide | undefined;
    if (statusValue && !TRADE_STATUSES.has(statusValue)) throw new Error('Invalid trade status');
    if (sideValue && !TRADE_SIDES.has(sideValue)) throw new Error('Invalid trade side');
    const symbol = url.searchParams.get('symbol');
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const cursor = url.searchParams.get('cursor') || undefined;

    const trades = await prisma.paperTrade.findMany({
      where: {
        userId,
        ...(statusValue ? { status: statusValue } : {}),
        ...(sideValue ? { side: sideValue } : {}),
        ...(symbol ? { symbol: normalizeUsEquitySymbol(symbol) } : {}),
      },
      include: { fills: { orderBy: [{ filledAt: 'asc' }, { createdAt: 'asc' }] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = trades.length > limit;
    const items = hasMore ? trades.slice(0, limit) : trades;
    return paperJson({ items, nextCursor: hasMore ? items[items.length - 1]?.id : null });
  } catch (error) {
    return paperError(error);
  }
}

export async function POST(request: Request) {
  const userId = await requirePaperUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const body = await readJsonObject(request);
    const symbol = normalizeUsEquitySymbol(body.symbol);
    const quote = await getPaperQuote(symbol);
    const side = String(body.side || '').toUpperCase() as PaperSide;
    if (!TRADE_SIDES.has(side)) throw new Error('side must be LONG or SHORT');

    const thesis = requiredString(body.thesis, 'thesis');
    const invalidation = requiredString(body.invalidation, 'invalidation');
    const plannedEntry =
      body.plannedEntry == null ? undefined : positiveDecimal(body.plannedEntry as string, 'plannedEntry');
    const stop = positiveDecimal((body.stop ?? body.plannedStop) as string, 'stop');
    const plannedStop =
      body.plannedStop == null ? stop : positiveDecimal(body.plannedStop as string, 'plannedStop');
    const plannedTarget =
      body.plannedTarget == null ? undefined : positiveDecimal(body.plannedTarget as string, 'plannedTarget');
    const target = body.target == null ? plannedTarget : positiveDecimal(body.target as string, 'target');
    const plannedShares =
      body.plannedShares == null ? undefined : positiveDecimal(body.plannedShares as string, 'plannedShares');
    validateStop(plannedEntry ?? quote.price, plannedStop, side);

    const account = await getOrCreatePaperAccount(userId);
    let plannedRisk: Prisma.Decimal | undefined;
    let plannedRiskPct: Prisma.Decimal | undefined;
    if (plannedEntry && plannedShares) {
      plannedRisk = calculateTradeRisk(plannedEntry, plannedStop, plannedShares, side);
      const equity = await getBookEquityForUser(userId);
      assertRiskWithinLimit(plannedRisk, equity);
      plannedRiskPct = riskPercent(plannedRisk, equity);
      if (side === 'LONG' && plannedEntry.mul(plannedShares).gt(account.cash)) {
        throw new Error('Planned long entry exceeds available cash');
      }
    }

    const insightMessageId = optionalString(body.insightMessageId, 'insightMessageId', 64);
    if (insightMessageId) {
      const message = await prisma.insightMessage.findFirst({
        where: { id: insightMessageId, session: { userId } },
        select: { id: true },
      });
      if (!message) throw new Error('insightMessageId is not accessible');
    }

    const trade = await prisma.paperTrade.create({
      data: {
        accountId: account.id,
        userId,
        symbol,
        side,
        status: 'PLANNED',
        thesis,
        invalidation,
        plannedEntry,
        plannedStop,
        plannedTarget,
        plannedRisk,
        plannedRiskPct,
        plannedShares,
        setupTag: optionalString(body.setupTag, 'setupTag', 100),
        strategyTag: optionalString(body.strategyTag, 'strategyTag', 100),
        stop,
        target,
        regimeSnapshot: jsonValue(body.regimeSnapshot, 'regimeSnapshot'),
        quantSnapshot: jsonValue(body.quantSnapshot, 'quantSnapshot'),
        insightMessageId,
        emotionTags: stringArray(body.emotionTags, 'emotionTags') ?? [],
        mistakeTags: stringArray(body.mistakeTags, 'mistakeTags') ?? [],
        preNotes: optionalString(body.preNotes, 'preNotes'),
      },
      include: { fills: true },
    });
    return paperJson(trade, 201);
  } catch (error) {
    return paperError(error);
  }
}
