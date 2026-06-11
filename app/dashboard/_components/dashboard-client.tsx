'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { MacroRibbon } from './macro-ribbon';
import { TickerSearch } from './ticker-search';
import { TickerGrid } from './ticker-grid';
import { WatchlistSidebar } from './watchlist-sidebar';
import { DetailModal } from './detail-modal';
import { SettingsModal } from './settings-modal';
import { Activity, LogOut, Settings, ChevronRight, ChevronLeft, Sparkles } from 'lucide-react';
import type { TickerCardData, WatchlistItem, MacroData } from '@/lib/types';
import { sectorForTicker } from '@/lib/watchlist-sectors';

const DEFAULT_TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA', 'META', 'JPM'];

export function DashboardClient() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const [tickers, setTickers] = useState<TickerCardData[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [watchlistPrices, setWatchlistPrices] = useState<Record<string, TickerCardData>>({});
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [showWatchlist, setShowWatchlist] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [macro, setMacro] = useState<MacroData | null>(null);
  const [loadingTickers, setLoadingTickers] = useState(true);

  // Fetch macro data
  const fetchMacro = useCallback(async () => {
    try {
      const res = await fetch('/api/market/macro');
      if (res.ok) {
        const data = await res.json();
        setMacro(data);
      }
    } catch { /* ignore */ }
  }, []);

  // Fetch ticker data
  const fetchTicker = useCallback(async (symbol: string): Promise<TickerCardData | null> => {
    try {
      const res = await fetch(`/api/market/ticker?symbol=${symbol}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (data?.error) return null;
      // Also fetch sentiment and risk in parallel
      const [sentRes, riskRes] = await Promise.all([
        fetch(`/api/market/sentiment?symbol=${symbol}`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/market/risk?symbol=${symbol}`).then(r => r.ok ? r.json() : null).catch(() => null),
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

  // Fetch watchlist (auto-seeds sector baskets when empty)
  const fetchWatchlist = useCallback(async () => {
    try {
      let res = await fetch('/api/watchlist', { cache: 'no-store' });
      if (!res.ok) {
        console.error('Watchlist fetch failed:', res.status, await res.text());
        return;
      }
      let data = await res.json();
      let items = Array.isArray(data) ? data : (data?.items ?? []);

      if (items.length === 0) {
        res = await fetch('/api/watchlist/bootstrap', { method: 'POST' });
        if (res.ok) {
          data = await res.json();
          items = data?.items ?? [];
        }
      }

      setWatchlist(items);
    } catch (err) {
      console.error('Watchlist fetch error:', err);
    }
  }, []);

  // Load initial data
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
    if (status !== 'authenticated') return;

    fetchMacro();
    fetchWatchlist();

    // Load default tickers
    setLoadingTickers(true);
    Promise.all(DEFAULT_TICKERS.map(fetchTicker)).then((results) => {
      const valid = (results ?? []).filter((r): r is TickerCardData => r !== null);
      setTickers(valid);
      setLoadingTickers(false);
    });

    // Auto-refresh macro every 60s
    const interval = setInterval(fetchMacro, 60000);
    return () => clearInterval(interval);
  }, [status, router, fetchMacro, fetchWatchlist, fetchTicker]);

  // Fetch watchlist prices
  useEffect(() => {
    if ((watchlist?.length ?? 0) === 0) return;
    const symbols = watchlist?.map((w: WatchlistItem) => w?.ticker)?.filter(Boolean) ?? [];
    symbols.forEach(async (sym: string) => {
      const data = await fetchTicker(sym);
      if (data) {
        setWatchlistPrices(prev => ({ ...(prev ?? {}), [sym]: data }));
      }
    });
  }, [watchlist, fetchTicker]);

  const handleAddTicker = async (symbol: string) => {
    const existing = tickers?.find((t: TickerCardData) => t?.symbol === symbol?.toUpperCase?.());
    if (existing) return;

    // Add placeholder immediately
    setTickers(prev => [...(prev ?? []), { symbol: symbol.toUpperCase(), name: '', price: 0, change: 0, changePercent: 0, loading: true }]);

    const data = await fetchTicker(symbol);
    if (data) {
      setTickers(prev => (prev ?? []).map((t: TickerCardData) => t?.symbol === symbol?.toUpperCase?.() ? data : t));
    } else {
      setTickers(prev => (prev ?? []).filter((t: TickerCardData) => t?.symbol !== symbol?.toUpperCase?.()));
    }
  };

  const handleToggleWatchlist = async (symbol: string) => {
    const isWatchlisted = watchlist?.some((w: WatchlistItem) => w?.ticker === symbol);
    if (isWatchlisted) {
      await fetch(`/api/watchlist?ticker=${symbol}`, { method: 'DELETE' });
    } else {
      await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: symbol, sector: sectorForTicker(symbol) }),
      });
    }
    fetchWatchlist();
  };

  const handleRemoveTicker = (symbol: string) => {
    setTickers(prev => (prev ?? []).filter((t: TickerCardData) => t?.symbol !== symbol));
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#00c853]/30 border-t-[#00c853] rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-card/95 backdrop-blur-sm border-b border-border">
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-[#00c853]/10 border border-[#00c853]/30 flex items-center justify-center">
              <Activity className="w-4 h-4 text-[#00c853]" />
            </div>
            <span className="font-display font-bold text-base tracking-tight hidden sm:block">Market Intel</span>
          </div>

          <div className="flex-1 max-w-xl mx-4">
            <TickerSearch onSelectTicker={handleAddTicker} />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push('/dashboard/insights')}
              className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="AI Insights"
            >
              <Sparkles className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowWatchlist(!showWatchlist)}
              className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors lg:hidden"
            >
              {showWatchlist ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
            <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-border">
              <span className="text-xs text-muted-foreground">{session?.user?.name || session?.user?.email}</span>
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
        <MacroRibbon data={macro} />
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto p-4">
          <TickerGrid
            tickers={tickers}
            watchlist={watchlist}
            loading={loadingTickers}
            onSelectTicker={setSelectedTicker}
            onToggleWatchlist={handleToggleWatchlist}
            onRemoveTicker={handleRemoveTicker}
          />
        </main>

        {/* Watchlist Sidebar */}
        <aside className={`${showWatchlist ? 'w-80 border-l border-border' : 'w-0'} transition-all duration-300 overflow-hidden bg-card/50 hidden lg:block`}>
          <WatchlistSidebar
            watchlist={watchlist}
            prices={watchlistPrices}
            onSelectTicker={setSelectedTicker}
            onRemove={handleToggleWatchlist}
          />
        </aside>
      </div>

      {/* Mobile watchlist */}
      {showWatchlist && (
        <div className="lg:hidden fixed inset-y-0 right-0 w-80 bg-card border-l border-border z-40 shadow-xl overflow-y-auto" style={{ top: '100px' }}>
          <WatchlistSidebar
            watchlist={watchlist}
            prices={watchlistPrices}
            onSelectTicker={(sym) => { setSelectedTicker(sym); setShowWatchlist(false); }}
            onRemove={handleToggleWatchlist}
          />
        </div>
      )}

      {/* Detail Modal */}
      {selectedTicker && (
        <DetailModal
          symbol={selectedTicker}
          onClose={() => setSelectedTicker(null)}
          isWatchlisted={watchlist?.some((w: WatchlistItem) => w?.ticker === selectedTicker)}
          onToggleWatchlist={() => handleToggleWatchlist(selectedTicker)}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
