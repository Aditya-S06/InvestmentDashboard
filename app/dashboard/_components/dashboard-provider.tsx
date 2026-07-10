'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useSession } from 'next-auth/react';
import type { MacroData, TickerCardData, WatchlistItem } from '@/lib/types';
import { sectorForTicker } from '@/lib/watchlist-sectors';

const GRID_STORAGE_KEY = 'market-intel-dashboard-grid';

interface DashboardContextValue {
  watchlist: WatchlistItem[];
  watchlistPrices: Record<string, TickerCardData>;
  tickers: TickerCardData[];
  macro: MacroData | null;
  loadingTickers: boolean;
  loadingWatchlist: boolean;
  addTicker: (symbol: string) => Promise<void>;
  removeTicker: (symbol: string) => void;
  toggleWatchlist: (symbol: string) => Promise<void>;
  refreshWatchlist: () => Promise<void>;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used within DashboardProvider');
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

export function DashboardProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [watchlistPrices, setWatchlistPrices] = useState<Record<string, TickerCardData>>({});
  const [tickers, setTickers] = useState<TickerCardData[]>([]);
  const [macro, setMacro] = useState<MacroData | null>(null);
  const [loadingTickers, setLoadingTickers] = useState(true);
  const [loadingWatchlist, setLoadingWatchlist] = useState(true);
  const watchlistLoaded = useRef(false);
  const gridHydrated = useRef(false);
  const watchlistPricesFetched = useRef<Set<string>>(new Set());

  const fetchTicker = useCallback(async (symbol: string): Promise<TickerCardData | null> => {
    try {
      const res = await fetch(`/api/market/ticker?symbol=${symbol}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (data?.error) return null;
      const [sentRes, riskRes] = await Promise.all([
        fetch(`/api/market/sentiment?symbol=${symbol}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(`/api/market/risk?symbol=${symbol}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      return {
        symbol: data?.symbol ?? symbol,
        name: data?.name ?? symbol,
        price: data?.price ?? 0,
        change: data?.change ?? 0,
        changePercent: data?.changePercent ?? 0,
        sentiment: sentRes ?? undefined,
        risk: riskRes ?? undefined,
      };
    } catch {
      return null;
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

  const refreshWatchlist = useCallback(async () => {
    try {
      const res = await fetch('/api/watchlist', { cache: 'no-store' });
      if (!res.ok) {
        console.error('Watchlist fetch failed:', res.status, await res.text());
        return;
      }
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data?.items ?? []);
      setWatchlist(items);
    } catch (err) {
      console.error('Watchlist fetch error:', err);
    } finally {
      setLoadingWatchlist(false);
    }
  }, []);

  // Hydrate grid from sessionStorage once per browser session
  useEffect(() => {
    if (status !== 'authenticated' || gridHydrated.current) return;
    gridHydrated.current = true;
    setTickers(readGridFromSession());
    setLoadingTickers(false);
  }, [status]);

  // Persist grid to sessionStorage (session-only, not DB)
  useEffect(() => {
    if (!gridHydrated.current) return;
    writeGridToSession(tickers);
  }, [tickers]);

  // Load watchlist + macro once while the dashboard layout is mounted
  useEffect(() => {
    if (status !== 'authenticated') return;
    if (!watchlistLoaded.current) {
      watchlistLoaded.current = true;
      refreshWatchlist();
    }
    fetchMacro();
    const interval = setInterval(fetchMacro, 60000);
    return () => clearInterval(interval);
  }, [status, refreshWatchlist, fetchMacro]);

  // Fetch watchlist prices once per symbol per layout mount
  useEffect(() => {
    if (watchlist.length === 0) return;
    watchlist.forEach((item) => {
      const sym = item.ticker;
      if (!sym || watchlistPricesFetched.current.has(sym)) return;
      watchlistPricesFetched.current.add(sym);
      fetchTicker(sym).then((data) => {
        if (data) setWatchlistPrices((prev) => ({ ...prev, [sym]: data }));
      });
    });
  }, [watchlist, fetchTicker]);

  const addTicker = useCallback(
    async (symbol: string) => {
      const upper = symbol.toUpperCase();
      const cached = watchlistPrices[upper];

      setTickers((prev) => {
        if (prev.some((t) => t.symbol === upper)) return prev;
        if (cached) return [...prev, cached];
        return [
          ...prev,
          { symbol: upper, name: '', price: 0, change: 0, changePercent: 0, loading: true },
        ];
      });

      if (cached) return;

      const data = await fetchTicker(symbol);
      if (data) {
        setTickers((prev) => prev.map((t) => (t.symbol === upper ? data : t)));
      } else {
        setTickers((prev) => prev.filter((t) => t.symbol !== upper));
      }
    },
    [fetchTicker, watchlistPrices],
  );

  const removeTicker = useCallback((symbol: string) => {
    setTickers((prev) => prev.filter((t) => t.symbol !== symbol));
  }, []);

  const toggleWatchlist = useCallback(
    async (symbol: string) => {
      const isWatchlisted = watchlist.some((w) => w.ticker === symbol);
      if (isWatchlisted) {
        await fetch(`/api/watchlist?ticker=${symbol}`, { method: 'DELETE' });
      } else {
        await fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker: symbol, sector: sectorForTicker(symbol) }),
        });
      }
      await refreshWatchlist();
    },
    [watchlist, refreshWatchlist],
  );

  return (
    <DashboardContext.Provider
      value={{
        watchlist,
        watchlistPrices,
        tickers,
        macro,
        loadingTickers,
        loadingWatchlist,
        addTicker,
        removeTicker,
        toggleWatchlist,
        refreshWatchlist,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}
