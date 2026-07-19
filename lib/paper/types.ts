import type { Prisma } from '@prisma/client';

export type DecimalLike = Prisma.Decimal | string | number;
export type PaperSide = 'LONG' | 'SHORT';
export type PaperStatus = 'PLANNED' | 'OPEN' | 'CLOSED' | 'CANCELLED';
export type FillSide = 'BUY' | 'SELL';
export type FillType = 'ENTRY' | 'ADD' | 'REDUCE' | 'EXIT';
export type ReviewType = 'DAY' | 'WEEK';

export interface PositionSizingInput {
  equity: DecimalLike;
  riskPercent: DecimalLike;
  entry: DecimalLike;
  stop: DecimalLike;
  side: PaperSide;
  quantityScale?: number;
}

export interface PositionSizingResult {
  riskAmount: Prisma.Decimal;
  riskPerShare: Prisma.Decimal;
  quantity: Prisma.Decimal;
  notional: Prisma.Decimal;
}

export interface FillState {
  side: PaperSide;
  status: PaperStatus;
  qty: DecimalLike;
  avgEntry: DecimalLike | null;
  avgExit: DecimalLike | null;
  closedQty: DecimalLike;
  realizedPnl: DecimalLike;
  fees: DecimalLike;
  cash: DecimalLike;
}

export interface FillInput {
  side: FillSide;
  type: FillType;
  qty: DecimalLike;
  price: DecimalLike;
  fee?: DecimalLike;
}

export interface FillResult {
  qty: Prisma.Decimal;
  avgEntry: Prisma.Decimal | null;
  avgExit: Prisma.Decimal | null;
  closedQty: Prisma.Decimal;
  realizedPnl: Prisma.Decimal;
  fees: Prisma.Decimal;
  cash: Prisma.Decimal;
  status: PaperStatus;
  realizedOnFill: Prisma.Decimal;
}

export interface PriceBar {
  date?: string;
  high: DecimalLike;
  low: DecimalLike;
  close?: DecimalLike;
}

export interface ExcursionResult {
  mfe: Prisma.Decimal;
  mae: Prisma.Decimal;
  exitEfficiency: Prisma.Decimal | null;
}

export interface MarkedPosition {
  side: PaperSide;
  qty: DecimalLike;
  avgEntry: DecimalLike;
  mark: DecimalLike;
}
