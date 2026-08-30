'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import type { MacroData, TickerCardData } from '@/lib/types';
import { useWatchlist } from './watchlist-provider';

const GRID_STORAGE_KEY = 'market-intel-dashboard-grid';

interface QuotesContextValue {
  tickers: TickerCardData[];
  watchlistPrices: Record<string, TickerCardData>;
  macro: MacroData | null;
  loadingTickers: boolean;
  addTicker: (symbol: string) => Promise<void>;
  removeTicker: (symbol: string) => void;
}

const QuotesContext = createContext<QuotesContextValue | null>(null);

export function useQuotes() {
  const ctx = useContext(QuotesContext);
  if (!ctx) throw new Error('useQuotes must be used within QuotesProvider');
  return ctx;
}

function readGridFromSession(): TickerCardData[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = sessionStorage.getItem(GRID_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeGridToSession(tickers: TickerCardData[]) {
  if (typeof window === 'undefined') return;
  try {
    if (tickers.length === 0) {
      sessionStorage.removeItem(GRID_STORAGE_KEY);
    } else {
      sessionStorage.setItem(GRID_STORAGE_KEY, JSON.stringify(tickers));
    }
  } catch {
    /* ignore quota errors */
  }
}

/** Mounted only on the home dashboard, which is the sole consumer of quotes and macro. */
export function QuotesProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const { watchlist } = useWatchlist();
  const [tickers, setTickers] = useState<TickerCardData[]>([]);
  const [watchlistPrices, setWatchlistPrices] = useState<Record<string, TickerCardData>>({});
  const [macro, setMacro] = useState<MacroData | null>(null);
  const [loadingTickers, setLoadingTickers] = useState(true);
  const gridHydrated = useRef(false);
  const pricesFetched = useRef<Set<string>>(new Set());

  const fetchCards = useCallback(async (symbols: string[]): Promise<Record<string, TickerCardData>> => {
    if (symbols.length === 0) return {};
    try {
      const res = await fetch(`/api/market/cards?symbols=${symbols.join(',')}`, { cache: 'no-store' });
      if (!res.ok) return {};
      const data = await res.json();
      const cards: unknown[] = Array.isArray(data?.cards) ? data.cards : [];
      const bySymbol: Record<string, TickerCardData> = {};
      for (const card of cards as TickerCardData[]) {
        if (card?.symbol) bySymbol[card.symbol] = card;
      }
      return bySymbol;
    } catch {
      return {};
    }
  }, []);

  const fetchMacro = useCallback(async () => {
    try {
      const res = await fetch('/api/market/macro');
      if (res.ok) setMacro(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  // Hydrate grid from sessionStorage once per browser session
  useEffect(() => {
    if (status !== 'authenticated' || gridHydrated.current) return;
    gridHydrated.current = true;
    setTickers(readGridFromSession());
    setLoadingTickers(false);
  }, [status]);

  useEffect(() => {
    if (!gridHydrated.current) return;
    writeGridToSession(tickers);
  }, [tickers]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetchMacro();
    const interval = setInterval(fetchMacro, 60000);
    return () => clearInterval(interval);
  }, [status, fetchMacro]);

  // One batch request for every sidebar symbol we have not priced yet
  useEffect(() => {
    const pending = watchlist
      .map((item) => item.ticker)
      .filter((symbol): symbol is string => !!symbol && !pricesFetched.current.has(symbol));
    if (pending.length === 0) return;
    pending.forEach((symbol) => pricesFetched.current.add(symbol));
    fetchCards(pending).then((cards) => {
      if (Object.keys(cards).length > 0) setWatchlistPrices((prev) => ({ ...prev, ...cards }));
    });
  }, [watchlist, fetchCards]);

  const addTicker = useCallback(
    async (symbol: string) => {
      const upper = symbol.toUpperCase();
      const cached = watchlistPrices[upper];

      setTickers((prev) => {
        if (prev.some((t) => t.symbol === upper)) return prev;
        if (cached) return [...prev, cached];
        return [...prev, { symbol: upper, name: '', price: 0, change: 0, changePercent: 0, loading: true }];
      });

      if (cached) return;

      const cards = await fetchCards([upper]);
      const data = cards[upper];
      if (data) {
        setTickers((prev) => prev.map((t) => (t.symbol === upper ? data : t)));
        setWatchlistPrices((prev) => ({ ...prev, [upper]: data }));
      } else {
        setTickers((prev) => prev.filter((t) => t.symbol !== upper));
      }
    },
    [fetchCards, watchlistPrices],
  );

  const removeTicker = useCallback((symbol: string) => {
    setTickers((prev) => prev.filter((t) => t.symbol !== symbol));
  }, []);

  return (
    <QuotesContext.Provider
      value={{ tickers, watchlistPrices, macro, loadingTickers, addTicker, removeTicker }}
    >
      {children}
    </QuotesContext.Provider>
  );
}
