export const UNCATEGORIZED_SECTOR = 'Uncategorized';

/** Optional sector labels for grouping; users assign sectors when adding tickers. */
export const WATCHLIST_SECTORS: { name: string; tickers: string[] }[] = [];

export const SECTOR_ORDER: string[] = [
  ...WATCHLIST_SECTORS.map((s) => s.name),
  UNCATEGORIZED_SECTOR,
];

const TICKER_TO_SECTOR = new Map<string, string>();
for (const sector of WATCHLIST_SECTORS) {
  for (const ticker of sector.tickers) {
    TICKER_TO_SECTOR.set(ticker.toUpperCase(), sector.name);
  }
}

export function sectorForTicker(ticker: string): string {
  return TICKER_TO_SECTOR.get(ticker.toUpperCase()) ?? UNCATEGORIZED_SECTOR;
}

export function sectorSortIndex(sector: string | null | undefined): number {
  const idx = SECTOR_ORDER.indexOf(sector ?? UNCATEGORIZED_SECTOR);
  return idx === -1 ? SECTOR_ORDER.length : idx;
}

export interface WatchlistLike {
  ticker: string;
  sector?: string | null;
}

export function groupWatchlistBySector<T extends WatchlistLike>(
  items: T[],
): { sector: string; items: T[] }[] {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const sector = item.sector || sectorForTicker(item.ticker);
    const list = groups.get(sector) ?? [];
    list.push(item);
    groups.set(sector, list);
  }

  const known = SECTOR_ORDER.filter((name) => groups.has(name)).map((sector) => ({
    sector,
    items: (groups.get(sector) ?? []).sort((a, b) => a.ticker.localeCompare(b.ticker)),
  }));

  const unknown = [...groups.keys()]
    .filter((name) => !SECTOR_ORDER.includes(name))
    .sort((a, b) => a.localeCompare(b))
    .map((sector) => ({
      sector,
      items: (groups.get(sector) ?? []).sort((a, b) => a.ticker.localeCompare(b.ticker)),
    }));

  return [...known, ...unknown];
}
