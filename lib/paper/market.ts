import 'server-only';

import { runPython } from '@/lib/python-runner';
import { calculateMfeMae } from './math';
import type { DecimalLike, ExcursionResult, PaperSide, PriceBar } from './types';

export interface PaperQuote {
  symbol: string;
  price: number;
  currency: string;
  asOf: string;
}

export function normalizeUsEquitySymbol(value: unknown): string {
  const symbol = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) {
    throw new Error('A valid US equity symbol is required');
  }
  return symbol;
}

export async function getPaperQuote(symbolValue: unknown): Promise<PaperQuote> {
  const symbol = normalizeUsEquitySymbol(symbolValue);
  const data = await runPython(['ticker', symbol]);
  const price = Number(data?.price);
  if (data?.error || !Number.isFinite(price) || price <= 0) {
    throw new Error(data?.error || `No current market price is available for ${symbol}`);
  }
  const currency = String(data?.currency || '').toUpperCase();
  if (currency !== 'USD') throw new Error(`${symbol} is not a USD-listed US equity`);
  return { symbol, price, currency, asOf: new Date().toISOString() };
}

export async function getPaperQuotes(
  symbols: string[],
): Promise<Record<string, PaperQuote | { symbol: string; error: string }>> {
  const unique = [...new Set(symbols.map(normalizeUsEquitySymbol))];
  const entries = await Promise.all(
    unique.map(async (symbol) => {
      try {
        return [symbol, await getPaperQuote(symbol)] as const;
      } catch (error) {
        return [
          symbol,
          { symbol, error: error instanceof Error ? error.message : 'Market data unavailable' },
        ] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

function historicalPeriod(openedAt: Date, closedAt: Date): string {
  const days = Math.max(1, Math.ceil((closedAt.getTime() - openedAt.getTime()) / 86_400_000));
  if (days <= 25) return '1mo';
  if (days <= 80) return '3mo';
  if (days <= 170) return '6mo';
  if (days <= 350) return '1y';
  if (days <= 700) return '2y';
  if (days <= 1_750) return '5y';
  return 'max';
}

export async function calculateHistoricalExcursion(input: {
  symbol: string;
  side: PaperSide;
  entry: DecimalLike;
  qty: DecimalLike;
  openedAt: Date;
  closedAt: Date;
  realizedPnl: DecimalLike;
}): Promise<ExcursionResult | null> {
  try {
    const symbol = normalizeUsEquitySymbol(input.symbol);
    const raw = await runPython(['historical', symbol, historicalPeriod(input.openedAt, input.closedAt)]);
    if (!Array.isArray(raw)) return null;
    const from = input.openedAt.toISOString().slice(0, 10);
    const through = input.closedAt.toISOString().slice(0, 10);
    const bars: PriceBar[] = raw
      .filter((bar) => typeof bar?.date === 'string' && bar.date >= from && bar.date <= through)
      .map((bar) => ({ date: bar.date, high: bar.high, low: bar.low, close: bar.close }));
    if (bars.length === 0) return null;
    return calculateMfeMae(input.side, input.entry, input.qty, bars, input.realizedPnl);
  } catch {
    return null;
  }
}
