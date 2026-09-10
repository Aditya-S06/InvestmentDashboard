export const DESK_DEPTHS = ['fast', 'standard', 'deep'] as const;
export type DeskDepth = (typeof DESK_DEPTHS)[number];

export function parseDeskDepth(value: string): DeskDepth | null {
  switch (value) {
    case 'fast':
    case 'standard':
    case 'deep':
      return value;
    default:
      return null;
  }
}

/** Tauric order: market, social, news, fundamentals. */
export const DESK_ANALYSTS = ['market', 'social', 'news', 'fundamentals'] as const;
export type DeskAnalyst = (typeof DESK_ANALYSTS)[number];

export const DESK_ASSET_TYPES = ['stock', 'crypto'] as const;
export type DeskAssetType = (typeof DESK_ASSET_TYPES)[number];

export type DeskRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'review';

/** Never coerce REVIEW to Hold. */
export type DeskSignal = 'Buy' | 'Overweight' | 'Hold' | 'Underweight' | 'Sell' | 'REVIEW';

export type CreateDeskRunInput = {
  tickers: string[]; // 1–3, uppercased
  asOf: string; // YYYY-MM-DD
  depth: DeskDepth;
  analysts: DeskAnalyst[]; // min 1; crypto runs exclude fundamentals
  assetType: DeskAssetType;
  checkpoint: boolean;
};

/** Live multi-ticker header: `NVDA 1/2`. Otherwise a comma-separated list. */
export function formatDeskTickerHeader(
  tickers: string[],
  activeTicker: string | null | undefined,
): string {
  if (tickers.length === 0) return '—';
  if (tickers.length === 1) return tickers[0] ?? '—';
  if (!activeTicker) return tickers.join(', ');
  const index = tickers.indexOf(activeTicker);
  if (index < 0) return tickers.join(', ');
  return `${activeTicker} ${index + 1}/${tickers.length}`;
}

export function deskHasMoreTickers(
  tickers: string[],
  activeTicker: string | null | undefined,
): boolean {
  if (tickers.length <= 1) return false;
  if (!activeTicker) return true;
  const index = tickers.indexOf(activeTicker);
  return index >= 0 && index < tickers.length - 1;
}
