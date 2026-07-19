export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  optionalDate,
  optionalString,
  paperError,
  paperJson,
  readJsonObject,
  requirePaperUser,
} from '@/lib/paper/http';
import { executePaperFill, updateTradeExcursion } from '@/lib/paper/service';

interface RouteContext {
  params: { id: string };
}

export async function POST(request: Request, { params }: RouteContext) {
  const userId = await requirePaperUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const body = await readJsonObject(request);
    const current = await prisma.paperTrade.findFirst({
      where: { id: params.id, userId, status: 'OPEN', qty: { gt: 0 } },
      select: { id: true, side: true, qty: true },
    });
    if (!current) return NextResponse.json({ error: 'Open trade not found' }, { status: 404 });

    let trade = await executePaperFill(userId, current.id, {
      side: current.side === 'LONG' ? 'SELL' : 'BUY',
      type: 'EXIT',
      qty: current.qty,
      price: body.price,
      fee: body.fee,
      filledAt: optionalDate(body.filledAt, 'filledAt'),
      note: optionalString(body.note, 'note'),
    });
    try {
      trade = (await updateTradeExcursion(userId, trade.id)) ?? trade;
    } catch {
      // A market-data failure leaves excursion fields null without changing the completed close.
    }
    return paperJson(trade);
  } catch (error) {
    return paperError(error);
  }
}
