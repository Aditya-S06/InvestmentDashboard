export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  journalError,
  journalJson,
  normalizeUsEquitySymbol,
  optionalDate,
  optionalDecimal,
  optionalString,
  readJsonObject,
  requiredDate,
  requiredDecimal,
  requiredString,
  requireJournalUser,
  stringArray,
} from '@/lib/journal/http';
import { computeRealizedPnl, listPersonalTrades, type PersonalSide, type PersonalStatus } from '@/lib/journal/service';

const STATUSES = new Set<PersonalStatus>(['OPEN', 'CLOSED']);
const SIDES = new Set<PersonalSide>(['LONG', 'SHORT']);

export async function GET(request: Request) {
  const userId = await requireJournalUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const url = new URL(request.url);
    const statusValue = url.searchParams.get('status')?.toUpperCase() as PersonalStatus | undefined;
    const sideValue = url.searchParams.get('side')?.toUpperCase() as PersonalSide | undefined;
    if (statusValue && !STATUSES.has(statusValue)) throw new Error('Invalid trade status');
    if (sideValue && !SIDES.has(sideValue)) throw new Error('Invalid trade side');
    const symbol = url.searchParams.get('symbol');
    const result = await listPersonalTrades(userId, {
      status: statusValue,
      side: sideValue,
      symbol: symbol ? normalizeUsEquitySymbol(symbol) : undefined,
      limit: Number(url.searchParams.get('limit') || 50),
      cursor: url.searchParams.get('cursor') || undefined,
    });
    return journalJson(result);
  } catch (error) {
    return journalError(error);
  }
}

export async function POST(request: Request) {
  const userId = await requireJournalUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const body = await readJsonObject(request);
    const symbol = normalizeUsEquitySymbol(body.symbol);
    const side = String(body.side || '').toUpperCase() as PersonalSide;
    if (!SIDES.has(side)) throw new Error('side must be LONG or SHORT');

    const entryPrice = requiredDecimal(body.entryPrice ?? body.avgEntry, 'entryPrice');
    const qty = requiredDecimal(body.qty, 'qty');
    if (Number(qty) <= 0) throw new Error('qty must be positive');
    const openedAt = requiredDate(body.openedAt ?? body.entryDate ?? new Date().toISOString(), 'openedAt');
    const exitPrice = optionalDecimal(body.exitPrice ?? body.avgExit, 'exitPrice');
    const closedAt = optionalDate(body.closedAt ?? body.exitDate, 'closedAt');
    const fees = optionalDecimal(body.fees, 'fees') ?? undefined;
    const statusRaw = String(body.status || (exitPrice || closedAt ? 'CLOSED' : 'OPEN')).toUpperCase() as PersonalStatus;
    if (!STATUSES.has(statusRaw)) throw new Error('status must be OPEN or CLOSED');
    if (statusRaw === 'CLOSED' && !exitPrice) throw new Error('exitPrice is required to close a trade');

    let realizedPnl = optionalDecimal(body.realizedPnl, 'realizedPnl');
    if (statusRaw === 'CLOSED' && exitPrice && realizedPnl == null) {
      realizedPnl = computeRealizedPnl({ side, qty, entryPrice, exitPrice, fees });
    }

    const trade = await prisma.personalTrade.create({
      data: {
        userId,
        symbol,
        side,
        status: statusRaw,
        broker: optionalString(body.broker, 'broker', 40),
        thesis: optionalString(body.thesis, 'thesis'),
        invalidation: optionalString(body.invalidation, 'invalidation'),
        entryPrice,
        exitPrice: statusRaw === 'CLOSED' ? exitPrice : null,
        stop: optionalDecimal(body.stop ?? body.stopPrice, 'stop'),
        target: optionalDecimal(body.target ?? body.targetPrice, 'target'),
        qty,
        openedAt,
        closedAt: statusRaw === 'CLOSED' ? closedAt ?? new Date() : null,
        fees: fees ?? undefined,
        realizedPnl: statusRaw === 'CLOSED' ? realizedPnl : null,
        setupTag: optionalString(body.setupTag, 'setupTag', 80),
        strategyTag: optionalString(body.strategyTag, 'strategyTag', 80),
        planFollowed: typeof body.planFollowed === 'boolean' ? body.planFollowed : undefined,
        emotionTags: stringArray(body.emotionTags, 'emotionTags') ?? [],
        mistakeTags: stringArray(body.mistakeTags, 'mistakeTags') ?? [],
        rating: body.rating == null || body.rating === '' ? undefined : Number(body.rating),
        preNotes: optionalString(body.preNotes, 'preNotes'),
        managementNotes: optionalString(body.managementNotes, 'managementNotes'),
        postNotes: optionalString(body.postNotes, 'postNotes'),
      },
    });

    return journalJson({ trade }, 201);
  } catch (error) {
    return journalError(error);
  }
}
