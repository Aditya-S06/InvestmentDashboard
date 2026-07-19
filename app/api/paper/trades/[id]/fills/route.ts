export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import {
  optionalDate,
  optionalString,
  paperError,
  paperJson,
  readJsonObject,
  requirePaperUser,
} from '@/lib/paper/http';
import { executePaperFill, updateTradeExcursion } from '@/lib/paper/service';
import type { FillSide, FillType } from '@/lib/paper/types';

interface RouteContext {
  params: { id: string };
}

const FILL_SIDES = new Set<FillSide>(['BUY', 'SELL']);
const FILL_TYPES = new Set<FillType>(['ENTRY', 'ADD', 'REDUCE', 'EXIT']);

export async function POST(request: Request, { params }: RouteContext) {
  const userId = await requirePaperUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const body = await readJsonObject(request);
    const side = String(body.side || '').toUpperCase() as FillSide;
    const type = String(body.type || '').toUpperCase() as FillType;
    if (!FILL_SIDES.has(side)) throw new Error('side must be BUY or SELL');
    if (!FILL_TYPES.has(type)) throw new Error('type must be ENTRY, ADD, REDUCE, or EXIT');

    let trade = await executePaperFill(userId, params.id, {
      side,
      type,
      qty: body.qty,
      price: body.price,
      fee: body.fee,
      filledAt: optionalDate(body.filledAt, 'filledAt'),
      note: optionalString(body.note, 'note'),
    });
    if (trade.status === 'CLOSED') {
      try {
        trade = (await updateTradeExcursion(userId, trade.id)) ?? trade;
      } catch {
        // Execution is authoritative; unavailable historical data must not undo a completed fill.
      }
    }
    return paperJson(trade, 201);
  } catch (error) {
    return paperError(error);
  }
}
