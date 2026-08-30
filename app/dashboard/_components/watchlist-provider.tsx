'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import type { WatchlistItem } from '@/lib/types';
import { sectorForTicker } from '@/lib/watchlist-sectors';

interface WatchlistContextValue {
  watchlist: WatchlistItem[];
  loadingWatchlist: boolean;
  refreshWatchlist: () => Promise<void>;
  toggleWatchlist: (symbol: string) => Promise<void>;
}

const WatchlistContext = createContext<WatchlistContextValue | null>(null);

export function useWatchlist() {
  const ctx = useContext(WatchlistContext);
  if (!ctx) throw new Error('useWatchlist must be used within WatchlistProvider');
  return ctx;
}

/**
 * Mounted on the dashboard layout: every page needs the watchlist, but only the
 * home grid needs quotes, so price fetching lives in QuotesProvider.
 */
export function WatchlistProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [loadingWatchlist, setLoadingWatchlist] = useState(true);
  const watchlistLoaded = useRef(false);

  const refreshWatchlist = useCallback(async () => {
    try {
      const res = await fetch('/api/watchlist', { cache: 'no-store' });
      if (!res.ok) {
        console.error('Watchlist fetch failed:', res.status);
        return;
      }
      const data = await res.json();
      setWatchlist(Array.isArray(data) ? data : (data?.items ?? []));
    } catch (err) {
      console.error('Watchlist fetch error:', err);
    } finally {
      setLoadingWatchlist(false);
    }
  }, []);

  useEffect(() => {
    if (status !== 'authenticated' || watchlistLoaded.current) return;
    watchlistLoaded.current = true;
    refreshWatchlist();
  }, [status, refreshWatchlist]);

  const toggleWatchlist = useCallback(
    async (symbol: string) => {
      const isWatchlisted = watchlist.some((w) => w.ticker === symbol);
      const res = isWatchlisted
        ? await fetch(`/api/watchlist?ticker=${symbol}`, { method: 'DELETE' })
        : await fetch('/api/watchlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker: symbol, sector: sectorForTicker(symbol) }),
          });

      if (!res.ok) {
        toast.error(`Could not ${isWatchlisted ? 'remove' : 'add'} ${symbol}`);
        return;
      }
      toast.success(isWatchlisted ? `${symbol} removed from watchlist` : `${symbol} added to watchlist`);
      await refreshWatchlist();
    },
    [watchlist, refreshWatchlist],
  );

  return (
    <WatchlistContext.Provider value={{ watchlist, loadingWatchlist, refreshWatchlist, toggleWatchlist }}>
      {children}
    </WatchlistContext.Provider>
  );
}
