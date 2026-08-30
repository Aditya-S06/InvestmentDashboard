import 'server-only';

import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isUsEquitySymbol } from '@/lib/market/symbol';
import { runPython, runWebull } from '@/lib/python-runner';
import { pythonErrorMessage } from './payload';
import {
  assertRiskReducingAllowed,
  assertTradingAllowed,
  getMaxNotionalUsd,
  getMaxQty,
  getWebullEnvironment,
  isSandboxEnvironment,
} from './config';
import { getKillSwitch, writeBrokerAudit } from './audit';
import { syncLiveFill } from './journal-sync';

export class TradingError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = 'trading_error',
  ) {
    super(message);
    this.name = 'TradingError';
  }
}

export type OrderSide = 'BUY' | 'SELL' | 'SHORT';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP_LOSS' | 'STOP_LOSS_LIMIT';
export type TradingSession = 'CORE' | 'ALL' | 'NIGHT';
export type TimeInForce = 'DAY' | 'GTC';
export type InstrumentType = 'EQUITY' | 'OPTION';

export type TicketInput = {
  accountId: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  qty: number;
  limitPrice?: number | null;
  stopPrice?: number | null;
  targetPrice?: number | null;
  session?: TradingSession;
  tif?: TimeInForce;
  lastPrice?: number | null;
  source?: string;
  thesis?: string | null;
  invalidation?: string | null;
  preNotes?: string | null;
  setupTag?: string | null;
  strategyTag?: string | null;
  sourceUrl?: string | null;
  liveConfirm?: string | null;
  instrumentType?: InstrumentType;
  comboLegs?: boolean;
  previewId?: string;
};

const TERMINAL = new Set(['FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED']);

export function newClientOrderId(): string {
  return randomUUID().replace(/-/g, '');
}

export function canonicalPayload(input: TicketInput) {
  return {
    accountId: input.accountId.trim(),
    symbol: input.symbol.trim().toUpperCase(),
    side: input.side,
    orderType: input.orderType,
    qty: input.qty,
    limitPrice: input.limitPrice ?? null,
    stopPrice: input.stopPrice ?? null,
    targetPrice: input.targetPrice ?? null,
    session: input.session ?? 'CORE',
    tif: input.tif ?? 'DAY',
    instrumentType: input.instrumentType ?? 'EQUITY',
    comboLegs: Boolean(input.comboLegs),
  };
}

export function hashPayload(input: TicketInput): string {
  return createHash('sha256').update(JSON.stringify(canonicalPayload(input))).digest('hex');
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parseTicket(body: Record<string, unknown>): TicketInput {
  const side = String(body.side || '').toUpperCase() as OrderSide;
  const orderType = String(body.orderType || body.order_type || 'LIMIT').toUpperCase() as OrderType;
  const session = String(body.session || body.support_trading_session || 'CORE').toUpperCase() as TradingSession;
  const tif = String(body.tif || body.time_in_force || 'DAY').toUpperCase() as TimeInForce;
  const instrumentType = String(body.instrumentType || 'EQUITY').toUpperCase() as InstrumentType;
  if (!['BUY', 'SELL', 'SHORT'].includes(side)) throw new TradingError('side must be BUY, SELL, or SHORT');
  if (!['MARKET', 'LIMIT', 'STOP_LOSS', 'STOP_LOSS_LIMIT'].includes(orderType)) {
    throw new TradingError('Unsupported order type');
  }
  if (!['CORE', 'ALL', 'NIGHT'].includes(session)) throw new TradingError('Invalid session');
  if (!['DAY', 'GTC'].includes(tif)) throw new TradingError('Invalid time in force');
  if (!['EQUITY', 'OPTION'].includes(instrumentType)) throw new TradingError('Invalid instrument type');

  const accountId = String(body.accountId || body.account_id || '').trim();
  if (!accountId) throw new TradingError('accountId required');

  const symbol = String(body.symbol || '').trim().toUpperCase();
  const qty = num(body.qty ?? body.quantity);
  return {
    accountId,
    symbol,
    side,
    orderType,
    qty,
    limitPrice: body.limitPrice == null && body.limit_price == null ? null : num(body.limitPrice ?? body.limit_price),
    stopPrice: body.stopPrice == null && body.stop_price == null ? null : num(body.stopPrice ?? body.stop_price),
    targetPrice: body.targetPrice == null && body.target_price == null ? null : num(body.targetPrice ?? body.target_price),
    session,
    tif,
    lastPrice: body.lastPrice == null ? null : num(body.lastPrice),
    source: String(body.source || 'ticket'),
    thesis: body.thesis != null ? String(body.thesis) : null,
    invalidation: body.invalidation != null ? String(body.invalidation) : null,
    preNotes: body.preNotes != null ? String(body.preNotes) : null,
    setupTag: body.setupTag != null ? String(body.setupTag) : null,
    strategyTag: body.strategyTag != null ? String(body.strategyTag) : null,
    sourceUrl: body.sourceUrl != null ? String(body.sourceUrl) : null,
    liveConfirm: body.liveConfirm != null ? String(body.liveConfirm) : null,
    instrumentType,
    comboLegs: Boolean(body.comboLegs),
    previewId: body.previewId != null ? String(body.previewId) : undefined,
  };
}

export function validateTicket(input: TicketInput) {
  if (input.instrumentType === 'OPTION') {
    if (input.orderType === 'MARKET') throw new TradingError('Options cannot use MARKET orders');
  } else if (!isUsEquitySymbol(input.symbol)) {
    throw new TradingError('US equity symbol required');
  }
  if (!(input.qty > 0) || !Number.isFinite(input.qty)) throw new TradingError('qty must be > 0');
  const fractional = input.qty > 0 && input.qty < 1;
  if (fractional && input.orderType !== 'MARKET') {
    throw new TradingError('Fractional shares require MARKET orders');
  }
  if (!fractional && !Number.isInteger(input.qty)) {
    throw new TradingError('qty must be a whole number of shares');
  }
  if (input.qty > getMaxQty()) throw new TradingError(`qty exceeds WEBULL_MAX_QTY (${getMaxQty()})`);
  if (input.orderType === 'MARKET' && input.session !== 'CORE') {
    throw new TradingError('MARKET orders require CORE session');
  }
  if (input.orderType === 'LIMIT' && !(input.limitPrice && input.limitPrice > 0)) {
    throw new TradingError('LIMIT requires limitPrice');
  }
  if (input.orderType === 'STOP_LOSS' && !(input.stopPrice && input.stopPrice > 0)) {
    throw new TradingError('STOP_LOSS requires stopPrice');
  }
  if (input.orderType === 'STOP_LOSS_LIMIT') {
    if (!(input.stopPrice && input.stopPrice > 0) || !(input.limitPrice && input.limitPrice > 0)) {
      throw new TradingError('STOP_LOSS_LIMIT requires stopPrice and limitPrice');
    }
  }
}

/**
 * Price the ticket carries itself. Client-supplied `lastPrice` is never used —
 * it is display-only and would let a caller zero out the notional cap.
 */
export function ticketReferencePrice(input: TicketInput): number {
  const candidates = [input.limitPrice, input.stopPrice].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0,
  );
  return candidates.length > 0 ? Math.max(...candidates) : 0;
}

/** Server-side last price for orders that carry no price of their own (MARKET). */
export async function fetchReferencePrice(symbol: string): Promise<number | null> {
  try {
    const data = await runPython(['ticker', symbol]);
    const price = Number(data?.price);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/**
 * Structural validation plus a notional cap that is always priced server-side.
 * Returns the reference price used so callers can audit the decision.
 */
export async function enforceRiskLimits(input: TicketInput): Promise<{ referencePrice: number }> {
  validateTicket(input);

  let referencePrice = ticketReferencePrice(input);
  if (!(referencePrice > 0)) {
    const quoted = await fetchReferencePrice(input.symbol);
    if (!(quoted && quoted > 0)) {
      throw new TradingError(
        `Cannot price ${input.symbol} for risk checks. Refusing to send an unpriced order.`,
        503,
        'quote_unavailable',
      );
    }
    referencePrice = quoted;
  }

  const notional = input.qty * referencePrice;
  if (notional > getMaxNotionalUsd()) {
    throw new TradingError(
      `Notional ${notional.toFixed(2)} exceeds WEBULL_MAX_NOTIONAL_USD (${getMaxNotionalUsd()})`,
    );
  }

  return { referencePrice };
}

function stockOrderDict(input: TicketInput, clientOrderId: string): Record<string, unknown> {
  const fractional = input.qty > 0 && input.qty < 1;
  const order: Record<string, unknown> = {
    combo_type: 'NORMAL',
    client_order_id: clientOrderId,
    symbol: input.symbol,
    instrument_type: input.instrumentType ?? 'EQUITY',
    market: 'US',
    order_type: input.orderType,
    quantity: String(input.qty),
    support_trading_session: input.session ?? 'CORE',
    side: input.side,
    time_in_force: input.tif ?? 'DAY',
    entrust_type: 'QTY',
  };
  if (input.limitPrice) order.limit_price = String(input.limitPrice);
  if (input.stopPrice) order.stop_price = String(input.stopPrice);
  if (fractional) order.entrust_type = 'QTY';
  return order;
}

function comboOrders(input: TicketInput, clientOrderId: string): Record<string, unknown> | Record<string, unknown>[] {
  const master = stockOrderDict(input, clientOrderId);
  if (!input.comboLegs || !input.stopPrice || !input.targetPrice) return master;
  const qty = String(input.qty);
  const exitSide = input.side === 'BUY' ? 'SELL' : 'BUY';
  return {
    combo_type: 'OTOCO',
    client_order_id: clientOrderId,
    new_orders: [
      { ...master, combo_type: 'MASTER' },
      {
        combo_type: 'STOP_LOSS',
        side: exitSide,
        order_type: 'STOP_LOSS',
        stop_price: String(input.stopPrice),
        quantity: qty,
        symbol: input.symbol,
        instrument_type: input.instrumentType ?? 'EQUITY',
        market: 'US',
        time_in_force: 'GTC',
        support_trading_session: 'CORE',
        entrust_type: 'QTY',
      },
      {
        combo_type: 'STOP_PROFIT',
        side: exitSide,
        order_type: 'LIMIT',
        limit_price: String(input.targetPrice),
        quantity: qty,
        symbol: input.symbol,
        instrument_type: input.instrumentType ?? 'EQUITY',
        market: 'US',
        time_in_force: 'GTC',
        support_trading_session: 'CORE',
        entrust_type: 'QTY',
      },
    ],
  };
}

async function pythonOrThrow(args: string[], options?: { stdinJson?: unknown; timeoutMs?: number }) {
  const data = await runWebull(args, options);
  const error = pythonErrorMessage(data);
  if (error) throw new TradingError(error, 502, 'webull_error');
  return data;
}

export async function tradingStatus() {
  const killSwitch = await getKillSwitch();
  const gate = assertTradingAllowed(killSwitch);
  return {
    configured: gate.ok || gate.code !== 'not_configured',
    environment: getWebullEnvironment(),
    tradingEnabled: gate.ok,
    liveEnabled: !isSandboxEnvironment() && gate.ok,
    killSwitch,
    maxNotionalUsd: getMaxNotionalUsd(),
    maxQty: getMaxQty(),
    code: gate.ok ? undefined : gate.code,
    error: gate.ok ? undefined : gate.error,
  };
}

export async function previewOrder(userId: string, input: TicketInput, ip?: string | null) {
  await enforceRiskLimits(input);
  const killSwitch = await getKillSwitch();
  const gate = assertTradingAllowed(killSwitch);
  if (!gate.ok) throw new TradingError(gate.error, gate.status, gate.code);

  const clientOrderId = newClientOrderId();
  const payloadHash = hashPayload(input);
  const order = comboOrders(input, clientOrderId);
  const webull = await pythonOrThrow(['preview', input.accountId], { stdinJson: order });

  const previewId = randomUUID();
  const row = await prisma.brokerOrder.create({
    data: {
      userId,
      accountId: input.accountId,
      environment: getWebullEnvironment(),
      clientOrderId,
      symbol: input.symbol,
      side: input.side,
      orderType: input.orderType,
      tif: input.tif ?? 'DAY',
      session: input.session ?? 'CORE',
      qty: new Prisma.Decimal(input.qty),
      limitPrice: input.limitPrice != null ? new Prisma.Decimal(input.limitPrice) : null,
      stopPrice: input.stopPrice != null ? new Prisma.Decimal(input.stopPrice) : null,
      status: 'PREVIEWED',
      source: input.source || 'ticket',
      thesis: input.thesis,
      invalidation: input.invalidation,
      preNotes: input.preNotes,
      setupTag: input.setupTag,
      strategyTag: input.strategyTag,
      sourceUrl: input.sourceUrl,
      payloadHash,
      previewId,
      previewExpiresAt: new Date(Date.now() + 60_000),
      webullPreview: webull as object,
      instrumentType: input.instrumentType ?? 'EQUITY',
      comboType: input.comboLegs && input.stopPrice && input.targetPrice ? 'OTOCO' : 'NORMAL',
    },
  });

  await writeBrokerAudit({
    userId,
    action: 'preview',
    clientOrderId,
    ip,
    payload: canonicalPayload(input),
    result: { previewId, webull },
  });

  return {
    previewId: row.previewId,
    clientOrderId,
    accountId: input.accountId,
    expiresAt: row.previewExpiresAt,
    preview: webull.preview ?? webull,
  };
}

export async function placeOrder(userId: string, input: TicketInput, ip?: string | null) {
  await enforceRiskLimits(input);
  const killSwitch = await getKillSwitch();
  const gate = assertTradingAllowed(killSwitch);
  if (!gate.ok) throw new TradingError(gate.error, gate.status, gate.code);
  if (!isSandboxEnvironment()) {
    if (input.liveConfirm !== 'LIVE') throw new TradingError('Type LIVE to confirm a live order', 400, 'live_confirm_required');
  }
  if (!input.previewId) throw new TradingError('previewId required', 400, 'preview_required');

  const previewId = input.previewId;
  const preview = await prisma.brokerOrder.findFirst({
    where: { previewId, userId },
  });
  if (!preview) throw new TradingError('Preview not found', 404, 'preview_missing');
  const payloadHash = hashPayload(input);
  if (preview.payloadHash !== payloadHash) throw new TradingError('Order changed since preview', 409, 'preview_stale');

  // Single-use claim: concurrent places on the same preview cannot both win.
  const claimed = await prisma.brokerOrder.updateMany({
    where: {
      previewId,
      userId,
      previewConsumed: false,
      previewExpiresAt: { gt: new Date() },
    },
    data: { status: 'SENDING', previewConsumed: true },
  });
  if (claimed.count !== 1) {
    const current = await prisma.brokerOrder.findFirst({
      where: { previewId, userId },
      select: { previewConsumed: true },
    });
    if (current?.previewConsumed) throw new TradingError('Preview already used', 409, 'preview_consumed');
    throw new TradingError('Preview expired', 410, 'preview_stale');
  }

  const order = comboOrders(input, preview.clientOrderId);
  try {
    const webull = await pythonOrThrow(['place', input.accountId], { stdinJson: order, timeoutMs: 45000 });
    const result = webull.result ?? webull;
    const webullOrderId =
      result?.order_id || result?.orderId || result?.data?.order_id || null;

    const updated = await prisma.brokerOrder.update({
      where: { id: preview.id },
      data: {
        status: 'SUBMITTED',
        webullOrderId: webullOrderId ? String(webullOrderId) : null,
        rawPlace: result as object,
      },
    });

    await writeBrokerAudit({
      userId,
      action: 'place',
      clientOrderId: preview.clientOrderId,
      ip,
      payload: canonicalPayload(input),
      result,
    });

    return { order: serializeOrder(updated), result };
  } catch (error) {
    await prisma.brokerOrder.update({
      where: { id: preview.id },
      data: { status: 'REJECTED' },
    });
    throw error;
  }
}

export async function cancelOrder(userId: string, clientOrderId: string, ip?: string | null) {
  // Cancels reduce risk, so they stay available while the kill switch is on.
  const gate = assertRiskReducingAllowed();
  if (!gate.ok) throw new TradingError(gate.error, gate.status, gate.code);

  const row = await prisma.brokerOrder.findFirst({ where: { clientOrderId, userId } });
  if (!row) throw new TradingError('Order not found', 404);
  const webull = await pythonOrThrow(['cancel', row.accountId, clientOrderId]);
  const updated = await prisma.brokerOrder.update({
    where: { id: row.id },
    data: { status: 'CANCELLED' },
  });
  await writeBrokerAudit({
    userId,
    action: 'cancel',
    clientOrderId,
    ip,
    result: webull,
  });
  return { order: serializeOrder(updated), result: webull.result ?? webull };
}

/** Rebuild the effective ticket a replace would produce, so it can be re-validated. */
function ticketFromOrder(
  row: {
    accountId: string;
    symbol: string;
    side: string;
    orderType: string;
    tif: string;
    session: string;
    qty: Prisma.Decimal;
    limitPrice: Prisma.Decimal | null;
    stopPrice: Prisma.Decimal | null;
    instrumentType: string;
  },
  patch: { quantity?: number; limitPrice?: number },
): TicketInput {
  return {
    accountId: row.accountId,
    symbol: row.symbol,
    side: row.side as OrderSide,
    orderType: row.orderType as OrderType,
    qty: patch.quantity ?? Number(row.qty),
    limitPrice: patch.limitPrice ?? (row.limitPrice == null ? null : Number(row.limitPrice)),
    stopPrice: row.stopPrice == null ? null : Number(row.stopPrice),
    session: row.session as TradingSession,
    tif: row.tif as TimeInForce,
    instrumentType: row.instrumentType as InstrumentType,
  };
}

export async function replaceOrder(
  userId: string,
  clientOrderId: string,
  patch: { quantity?: number; limitPrice?: number },
  ip?: string | null,
) {
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value <= 0) throw new TradingError(`${field} must be a positive number`);
  }
  if (patch.quantity == null && patch.limitPrice == null) {
    throw new TradingError('quantity or limitPrice required');
  }

  const row = await prisma.brokerOrder.findFirst({ where: { clientOrderId, userId } });
  if (!row) throw new TradingError('Order not found', 404);

  const currentTicket = ticketFromOrder(row, {});
  const nextTicket = ticketFromOrder(row, patch);
  const { referencePrice } = await enforceRiskLimits(nextTicket);

  // A replace that does not grow exposure is risk-reducing and stays allowed
  // during a kill switch; anything larger goes through the full trading gate.
  const currentNotional = currentTicket.qty * (ticketReferencePrice(currentTicket) || referencePrice);
  const reduceOnly = nextTicket.qty * referencePrice <= currentNotional + 1e-9;
  const gate = reduceOnly ? assertRiskReducingAllowed() : assertTradingAllowed(await getKillSwitch());
  if (!gate.ok) throw new TradingError(gate.error, gate.status, gate.code);

  const modify: Record<string, unknown> = { client_order_id: clientOrderId };
  if (patch.quantity != null) modify.quantity = String(patch.quantity);
  if (patch.limitPrice != null) modify.limit_price = String(patch.limitPrice);
  const webull = await pythonOrThrow(['replace', row.accountId], { stdinJson: modify });
  const updated = await prisma.brokerOrder.update({
    where: { id: row.id },
    data: {
      qty: patch.quantity != null ? new Prisma.Decimal(patch.quantity) : undefined,
      limitPrice: patch.limitPrice != null ? new Prisma.Decimal(patch.limitPrice) : undefined,
    },
  });
  await writeBrokerAudit({
    userId,
    action: 'replace',
    clientOrderId,
    ip,
    payload: patch,
    result: webull,
  });
  return { order: serializeOrder(updated), result: webull.result ?? webull };
}

function mapStatus(raw: unknown, filledQty: number, qty: number): string {
  const status = String(raw || '').toUpperCase();
  if (status.includes('CANCEL')) return 'CANCELLED';
  if (status.includes('FAIL') || status.includes('REJECT')) return 'REJECTED';
  if (status.includes('EXPIRE')) return 'EXPIRED';
  if (status.includes('FILL') && filledQty + 1e-9 >= qty) return 'FILLED';
  if (status.includes('FILL') || filledQty > 0) return filledQty + 1e-9 >= qty ? 'FILLED' : 'PARTIAL';
  if (status.includes('SUBMIT') || status.includes('PENDING') || status.includes('WORKING')) return 'SUBMITTED';
  return status || 'SUBMITTED';
}

export async function refreshOrderDetail(userId: string, clientOrderId: string) {
  const row = await prisma.brokerOrder.findFirst({ where: { clientOrderId, userId } });
  if (!row) throw new TradingError('Order not found', 404);
  const webull = await pythonOrThrow(['order-detail', row.accountId, clientOrderId]);
  const detail = webull.order ?? webull;
  const filledQty = num(detail.filled_qty ?? detail.filledQty ?? detail.cum_filled_qty, Number(row.filledQty));
  const avg = detail.avg_filled_price ?? detail.avgFillPrice ?? detail.filled_price ?? detail.filledPrice;
  const status = mapStatus(detail.order_status ?? detail.orderStatus ?? detail.status, filledQty, Number(row.qty));
  const updated = await prisma.brokerOrder.update({
    where: { id: row.id },
    data: {
      status,
      filledQty: new Prisma.Decimal(filledQty),
      avgFillPrice: avg != null && avg !== '' ? new Prisma.Decimal(num(avg)) : row.avgFillPrice,
      lastWebullDetail: detail as object,
      webullOrderId: detail.order_id ? String(detail.order_id) : row.webullOrderId,
    },
  });

  let journalTradeId: string | null = null;
  if (filledQty > Number(row.filledQty) && avg != null) {
    try {
      await prisma.brokerOrderFill.create({
        data: {
          brokerOrderId: row.id,
          filledQty: new Prisma.Decimal(filledQty),
          filledPrice: new Prisma.Decimal(num(avg)),
          filledAt: new Date(detail.filled_time || detail.filledTime || Date.now()),
          sceneType: filledQty + 1e-9 >= Number(row.qty) ? 'FINAL_FILLED' : 'FILLED',
          raw: detail as object,
        },
      });
    } catch {
      // unique constraint — duplicate snapshot
    }
    if (updated.environment === 'prod') {
      const trade = await syncLiveFill(updated);
      journalTradeId = trade?.id ?? null;
    }
  }

  // journalTradeId lets the UI link a fresh live fill straight to the journal.
  return { order: serializeOrder(updated), webull: detail, journalTradeId };
}

export async function listOrders(userId: string, accountId?: string) {
  const rows = await prisma.brokerOrder.findMany({
    where: {
      userId,
      ...(accountId ? { accountId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map(serializeOrder);
}

export function asOrderRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const row = raw as Record<string, unknown>;
    for (const key of ['orders', 'data', 'list', 'result']) {
      if (Array.isArray(row[key])) return row[key] as unknown[];
    }
  }
  return [];
}

export async function listOpenFromBroker(accountId: string) {
  return pythonOrThrow(['open-orders', accountId]);
}

export async function listHistoryFromBroker(accountId: string) {
  return pythonOrThrow(['order-history', accountId]);
}

export function serializeOrder(row: {
  id: string;
  accountId: string;
  environment: string;
  clientOrderId: string;
  webullOrderId: string | null;
  symbol: string;
  side: string;
  orderType: string;
  tif: string;
  session: string;
  qty: Prisma.Decimal;
  limitPrice: Prisma.Decimal | null;
  stopPrice: Prisma.Decimal | null;
  status: string;
  filledQty: Prisma.Decimal;
  avgFillPrice: Prisma.Decimal | null;
  fees: Prisma.Decimal;
  source: string;
  thesis: string | null;
  personalTradeId: string | null;
  previewId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    accountId: row.accountId,
    environment: row.environment,
    clientOrderId: row.clientOrderId,
    webullOrderId: row.webullOrderId,
    symbol: row.symbol,
    side: row.side,
    orderType: row.orderType,
    tif: row.tif,
    session: row.session,
    qty: Number(row.qty),
    limitPrice: row.limitPrice == null ? null : Number(row.limitPrice),
    stopPrice: row.stopPrice == null ? null : Number(row.stopPrice),
    status: row.status,
    filledQty: Number(row.filledQty),
    avgFillPrice: row.avgFillPrice == null ? null : Number(row.avgFillPrice),
    fees: Number(row.fees),
    source: row.source,
    thesis: row.thesis,
    personalTradeId: row.personalTradeId,
    previewId: row.previewId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    terminal: TERMINAL.has(row.status),
  };
}

export function tradingErrorResponse(error: unknown) {
  if (error instanceof TradingError) {
    return { status: error.status, body: { error: error.message, code: error.code } };
  }
  const message = error instanceof Error ? error.message : 'Trading request failed';
  return { status: 500, body: { error: message } };
}
