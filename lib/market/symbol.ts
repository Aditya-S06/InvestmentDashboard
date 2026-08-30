/**
 * Input guards for anything forwarded to scripts/market_data.py. execFile already
 * avoids a shell, so these exist to keep junk out of Yahoo lookups and logs.
 */

/** Equities, indices (^GSPC), crypto pairs (BTC-USD), and futures (CL=F). */
const MARKET_SYMBOL = /^[A-Z0-9][A-Z0-9.\-^=]{0,14}$/;

const HISTORICAL_PERIODS = new Set([
  '1d',
  '5d',
  '1mo',
  '3mo',
  '6mo',
  '1y',
  '2y',
  '5y',
  '10y',
  'ytd',
  'max',
]);

export const MAX_SEARCH_QUERY_LENGTH = 40;

export function normalizeMarketSymbol(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const symbol = raw.trim().toUpperCase();
  return MARKET_SYMBOL.test(symbol) ? symbol : null;
}

export function normalizeHistoricalPeriod(raw: unknown): string | null {
  if (raw == null || raw === '') return '6mo';
  if (typeof raw !== 'string') return null;
  const period = raw.trim().toLowerCase();
  return HISTORICAL_PERIODS.has(period) ? period : null;
}

export function normalizeSearchQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const query = raw.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
  return /^[A-Za-z0-9.\-^=&' ]+$/.test(query) ? query : null;
}

/** US equity tickers only — used to gate broker order routing. */
export function isUsEquitySymbol(symbol: string): boolean {
  const s = symbol.trim().toUpperCase();
  if (!s || s.startsWith('^') || s.includes('/') || s.endsWith('-USD') || s.endsWith('=F')) return false;
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s);
}
