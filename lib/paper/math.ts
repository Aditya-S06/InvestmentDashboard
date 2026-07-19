import 'server-only';

import { Prisma } from '@prisma/client';
import type {
  DecimalLike,
  ExcursionResult,
  FillInput,
  FillResult,
  FillState,
  MarkedPosition,
  PaperSide,
  PositionSizingInput,
  PositionSizingResult,
  PriceBar,
} from './types';

const ZERO = new Prisma.Decimal(0);
const ONE_HUNDRED = new Prisma.Decimal(100);

export function toDecimal(value: DecimalLike, field = 'value'): Prisma.Decimal {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  try {
    const decimal = new Prisma.Decimal(value);
    if (!decimal.isFinite()) throw new Error();
    return decimal;
  } catch {
    throw new Error(`${field} must be a valid decimal`);
  }
}

export function positiveDecimal(value: DecimalLike, field: string): Prisma.Decimal {
  const decimal = toDecimal(value, field);
  if (!decimal.gt(0)) throw new Error(`${field} must be greater than zero`);
  return decimal;
}

export function nonNegativeDecimal(value: DecimalLike, field: string): Prisma.Decimal {
  const decimal = toDecimal(value, field);
  if (decimal.lt(0)) throw new Error(`${field} cannot be negative`);
  return decimal;
}

export function decimalString(value: DecimalLike | null | undefined): string | null {
  return value == null ? null : toDecimal(value).toFixed();
}

export function validateStop(entryValue: DecimalLike, stopValue: DecimalLike, side: PaperSide): void {
  const entry = positiveDecimal(entryValue, 'entry');
  const stop = positiveDecimal(stopValue, 'stop');
  if (side === 'LONG' && !stop.lt(entry)) throw new Error('Long stop must be below entry');
  if (side === 'SHORT' && !stop.gt(entry)) throw new Error('Short stop must be above entry');
}

export function calculateTradeRisk(
  entryValue: DecimalLike,
  stopValue: DecimalLike,
  qtyValue: DecimalLike,
  side: PaperSide,
): Prisma.Decimal {
  validateStop(entryValue, stopValue, side);
  const entry = positiveDecimal(entryValue, 'entry');
  const stop = positiveDecimal(stopValue, 'stop');
  const qty = positiveDecimal(qtyValue, 'qty');
  return entry.minus(stop).abs().mul(qty);
}

export function calculatePositionSize(input: PositionSizingInput): PositionSizingResult {
  const equity = positiveDecimal(input.equity, 'equity');
  const riskPercent = positiveDecimal(input.riskPercent, 'riskPercent');
  if (riskPercent.gt(ONE_HUNDRED)) throw new Error('riskPercent cannot exceed 100');
  validateStop(input.entry, input.stop, input.side);

  const entry = positiveDecimal(input.entry, 'entry');
  const stop = positiveDecimal(input.stop, 'stop');
  const riskAmount = equity.mul(riskPercent).div(ONE_HUNDRED);
  const riskPerShare = entry.minus(stop).abs();
  const quantity = riskAmount
    .div(riskPerShare)
    .toDecimalPlaces(input.quantityScale ?? 6, Prisma.Decimal.ROUND_DOWN);

  if (!quantity.gt(0)) throw new Error('Calculated quantity is zero');
  return { riskAmount, riskPerShare, quantity, notional: entry.mul(quantity) };
}

export function riskPercent(riskValue: DecimalLike, equityValue: DecimalLike): Prisma.Decimal {
  const equity = positiveDecimal(equityValue, 'equity');
  return nonNegativeDecimal(riskValue, 'risk').div(equity).mul(ONE_HUNDRED);
}

export function assertRiskWithinLimit(
  riskValue: DecimalLike,
  equityValue: DecimalLike,
  maximumPercent: DecimalLike = '1.5',
): Prisma.Decimal {
  const percent = riskPercent(riskValue, equityValue);
  const maximum = positiveDecimal(maximumPercent, 'maximumPercent');
  if (percent.gt(maximum)) {
    throw new Error(`Trade risk ${percent.toDecimalPlaces(4).toFixed()}% exceeds ${maximum.toFixed()}% limit`);
  }
  return percent;
}

export function calculatePnl(
  side: PaperSide,
  entryValue: DecimalLike,
  exitValue: DecimalLike,
  qtyValue: DecimalLike,
  feesValue: DecimalLike = 0,
): Prisma.Decimal {
  const entry = positiveDecimal(entryValue, 'entry');
  const exit = positiveDecimal(exitValue, 'exit');
  const qty = positiveDecimal(qtyValue, 'qty');
  const fees = nonNegativeDecimal(feesValue, 'fees');
  const direction = side === 'LONG' ? new Prisma.Decimal(1) : new Prisma.Decimal(-1);
  return exit.minus(entry).mul(qty).mul(direction).minus(fees);
}

export function calculateRMultiple(pnlValue: DecimalLike, initialRiskValue: DecimalLike): Prisma.Decimal | null {
  const risk = nonNegativeDecimal(initialRiskValue, 'initialRisk');
  if (risk.isZero()) return null;
  return toDecimal(pnlValue, 'pnl').div(risk);
}

export function applyFill(state: FillState, input: FillInput): FillResult {
  if (state.status === 'CLOSED' || state.status === 'CANCELLED') {
    throw new Error(`Cannot fill a ${state.status.toLowerCase()} trade`);
  }

  const qty = positiveDecimal(input.qty, 'qty');
  const price = positiveDecimal(input.price, 'price');
  const fee = nonNegativeDecimal(input.fee ?? 0, 'fee');
  const currentQty = nonNegativeDecimal(state.qty, 'current qty');
  const closedQty = nonNegativeDecimal(state.closedQty, 'closed qty');
  const priorFees = nonNegativeDecimal(state.fees, 'fees');
  const priorRealized = toDecimal(state.realizedPnl, 'realizedPnl');
  const cash = toDecimal(state.cash, 'cash');
  const opening = input.type === 'ENTRY' || input.type === 'ADD';
  const expectedSide: 'BUY' | 'SELL' =
    state.side === 'LONG' ? (opening ? 'BUY' : 'SELL') : opening ? 'SELL' : 'BUY';

  if (input.side !== expectedSide) {
    throw new Error(`${input.type} for a ${state.side.toLowerCase()} trade must be a ${expectedSide}`);
  }
  if (input.type === 'ENTRY' && (!currentQty.isZero() || state.status !== 'PLANNED')) {
    throw new Error('ENTRY is only valid for an unfilled planned trade');
  }
  if (input.type === 'ADD' && (currentQty.isZero() || state.status !== 'OPEN')) {
    throw new Error('ADD requires an open position');
  }
  if (!opening && (currentQty.isZero() || state.status !== 'OPEN')) {
    throw new Error(`${input.type} requires an open position`);
  }
  if (!opening && qty.gt(currentQty)) throw new Error('Fill quantity exceeds the open position');
  if (input.type === 'REDUCE' && qty.eq(currentQty)) throw new Error('Use EXIT to close the full position');
  if (input.type === 'EXIT' && !qty.eq(currentQty)) throw new Error('EXIT must close the full position');

  const notional = price.mul(qty);
  const nextCash = input.side === 'BUY' ? cash.minus(notional).minus(fee) : cash.plus(notional).minus(fee);
  const nextFees = priorFees.plus(fee);
  let nextQty = currentQty;
  let nextClosedQty = closedQty;
  let avgEntry = state.avgEntry == null ? null : positiveDecimal(state.avgEntry, 'avgEntry');
  let avgExit = state.avgExit == null ? null : positiveDecimal(state.avgExit, 'avgExit');
  let grossRealized = priorRealized.plus(priorFees);

  if (opening) {
    const existingCost = avgEntry ? avgEntry.mul(currentQty) : ZERO;
    nextQty = currentQty.plus(qty);
    avgEntry = existingCost.plus(price.mul(qty)).div(nextQty);
  } else {
    if (!avgEntry) throw new Error('Open position is missing an average entry');
    const direction = state.side === 'LONG' ? new Prisma.Decimal(1) : new Prisma.Decimal(-1);
    grossRealized = grossRealized.plus(price.minus(avgEntry).mul(qty).mul(direction));
    const priorExitValue = avgExit ? avgExit.mul(closedQty) : ZERO;
    nextClosedQty = closedQty.plus(qty);
    avgExit = priorExitValue.plus(price.mul(qty)).div(nextClosedQty);
    nextQty = currentQty.minus(qty);
  }

  const nextRealized = grossRealized.minus(nextFees);
  return {
    qty: nextQty,
    avgEntry,
    avgExit,
    closedQty: nextClosedQty,
    realizedPnl: nextRealized,
    fees: nextFees,
    cash: nextCash,
    status: nextQty.isZero() ? (opening ? 'OPEN' : 'CLOSED') : 'OPEN',
    realizedOnFill: nextRealized.minus(priorRealized),
  };
}

export function calculateMarkedEquity(cashValue: DecimalLike, positions: MarkedPosition[]): Prisma.Decimal {
  return positions.reduce((equity, position) => {
    const qty = nonNegativeDecimal(position.qty, 'qty');
    const mark = positiveDecimal(position.mark, 'mark');
    const marketValue = qty.mul(mark);
    return position.side === 'LONG' ? equity.plus(marketValue) : equity.minus(marketValue);
  }, toDecimal(cashValue, 'cash'));
}

export function calculateUnrealizedPnl(position: MarkedPosition): Prisma.Decimal {
  return calculatePnl(position.side, position.avgEntry, position.mark, position.qty);
}

export function calculateMfeMae(
  side: PaperSide,
  entryValue: DecimalLike,
  qtyValue: DecimalLike,
  bars: PriceBar[],
  realizedPnlValue?: DecimalLike | null,
): ExcursionResult {
  if (bars.length === 0) throw new Error('At least one price bar is required');
  const entry = positiveDecimal(entryValue, 'entry');
  const qty = positiveDecimal(qtyValue, 'qty');
  let best = ZERO;
  let worst = ZERO;

  for (const bar of bars) {
    const high = positiveDecimal(bar.high, 'bar high');
    const low = positiveDecimal(bar.low, 'bar low');
    if (low.gt(high)) throw new Error('Bar low cannot exceed bar high');
    const favorable = side === 'LONG' ? high.minus(entry) : entry.minus(low);
    const adverse = side === 'LONG' ? low.minus(entry) : entry.minus(high);
    if (favorable.gt(best)) best = favorable;
    if (adverse.lt(worst)) worst = adverse;
  }

  const mfe = best.mul(qty);
  const mae = worst.mul(qty);
  const exitEfficiency =
    realizedPnlValue == null || mfe.isZero()
      ? null
      : toDecimal(realizedPnlValue, 'realizedPnl').div(mfe).mul(ONE_HUNDRED);
  return { mfe, mae, exitEfficiency };
}
