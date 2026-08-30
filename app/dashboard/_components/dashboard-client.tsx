'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { MacroRibbon } from './macro-ribbon';
import { TickerSearch } from './ticker-search';
import { TickerGrid } from './ticker-grid';
import { WatchlistSidebar } from './watchlist-sidebar';
import { DetailModal } from './detail-modal';
import { SettingsModal } from './settings-modal';
import { useQuotes } from './quotes-provider';
import { useWatchlist } from './watchlist-provider';
import { Settings, ChevronRight, ChevronLeft } from 'lucide-react';

export function DashboardClient() {
  const { status } = useSession() || {};
  const router = useRouter();
  const { tickers, watchlistPrices, macro, loadingTickers, addTicker, removeTicker } = useQuotes();
  const { watchlist, loadingWatchlist, toggleWatchlist } = useWatchlist();
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [showWatchlist, setShowWatchlist] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

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

  if (status === 'unauthenticated') {
    return null;
  }

  return (
    <div className="h-full bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-card/95 backdrop-blur-sm border-b border-border">
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex-1 max-w-xl">
            <TickerSearch onSelectTicker={addTicker} />
          </div>

          <div className="flex items-center gap-2">
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
            onToggleWatchlist={toggleWatchlist}
            onRemoveTicker={removeTicker}
            onDropTicker={addTicker}
          />
        </main>

        {/* Watchlist Sidebar */}
        <aside className={`${showWatchlist ? 'w-80 border-l border-border' : 'w-0'} transition-all duration-300 overflow-hidden bg-card/50 hidden lg:block`}>
          <WatchlistSidebar
            watchlist={watchlist}
            prices={watchlistPrices}
            loading={loadingWatchlist}
            onSelectTicker={setSelectedTicker}
            onRemove={toggleWatchlist}
          />
        </aside>
      </div>

      {/* Mobile watchlist */}
      {showWatchlist && (
        <div className="lg:hidden fixed inset-y-0 right-0 w-80 bg-card border-l border-border z-40 shadow-xl overflow-y-auto" style={{ top: '100px' }}>
          <WatchlistSidebar
            watchlist={watchlist}
            prices={watchlistPrices}
            loading={loadingWatchlist}
            onSelectTicker={(sym) => { setSelectedTicker(sym); setShowWatchlist(false); }}
            onRemove={toggleWatchlist}
          />
        </div>
      )}

      {/* Detail Modal */}
      {selectedTicker && (
        <DetailModal
          symbol={selectedTicker}
          onClose={() => setSelectedTicker(null)}
          isWatchlisted={watchlist?.some((w) => w?.ticker === selectedTicker)}
          onToggleWatchlist={() => toggleWatchlist(selectedTicker)}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
