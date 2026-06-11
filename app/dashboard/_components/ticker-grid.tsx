'use client';

import { Star, X, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import type { TickerCardData, WatchlistItem } from '@/lib/types';

function formatPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n) || n === 0) return '—';
  return '$' + n.toFixed(2);
}

function formatLargeNum(n: number | null | undefined): string {
  if (!n || isNaN(n)) return '—';
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(1) + 'T';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  return '$' + n.toFixed(0);
}

function SentimentBar({ score, label }: { score: number; label: string }) {
  const clampedScore = Math.max(0, Math.min(100, score ?? 50));
  const getColor = (s: number) => {
    if (s >= 70) return '#00c853';
    if (s >= 55) return '#66bb6a';
    if (s >= 45) return '#ffa726';
    if (s >= 30) return '#ef5350';
    return '#ff1744';
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[9px] text-muted-foreground">Fear</span>
        <span className="text-[9px] font-medium" style={{ color: getColor(clampedScore) }}>{label}</span>
        <span className="text-[9px] text-muted-foreground">Greed</span>
      </div>
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${clampedScore}%`, backgroundColor: getColor(clampedScore) }}
        />
      </div>
    </div>
  );
}

function RiskBadge({ score }: { score: number }) {
  const s = Math.max(1, Math.min(100, score ?? 50));
  const color = s < 33 ? '#00c853' : s < 66 ? '#ffa726' : '#ff1744';
  const label = s < 33 ? 'Low' : s < 66 ? 'Med' : 'High';

  return (
    <div className="flex flex-col items-center">
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-mono font-bold border-2"
        style={{ borderColor: color, color }}
      >
        {s}
      </div>
      <span className="text-[8px] mt-0.5 font-medium" style={{ color }}>{label} Risk</span>
    </div>
  );
}

interface TickerGridProps {
  tickers: TickerCardData[];
  watchlist: WatchlistItem[];
  loading: boolean;
  onSelectTicker: (symbol: string) => void;
  onToggleWatchlist: (symbol: string) => void;
  onRemoveTicker: (symbol: string) => void;
}

export function TickerGrid({ tickers, watchlist, loading, onSelectTicker, onToggleWatchlist, onRemoveTicker }: TickerGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-lg p-4 animate-pulse">
            <div className="h-4 bg-secondary rounded w-16 mb-3" />
            <div className="h-6 bg-secondary rounded w-24 mb-2" />
            <div className="h-3 bg-secondary rounded w-20 mb-4" />
            <div className="h-1.5 bg-secondary rounded w-full mb-2" />
            <div className="flex justify-between">
              <div className="h-8 bg-secondary rounded w-10" />
              <div className="h-8 bg-secondary rounded w-10" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if ((tickers?.length ?? 0) === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <TrendingUp className="w-10 h-10 mb-3 opacity-30" />
        <p className="text-sm">No tickers loaded. Use the search bar above to add stocks.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {(tickers ?? []).map((ticker: TickerCardData) => {
        const isPositive = (ticker?.change ?? 0) >= 0;
        const isWatchlisted = watchlist?.some((w: WatchlistItem) => w?.ticker === ticker?.symbol);

        if (ticker?.loading) {
          return (
            <div key={ticker?.symbol} className="bg-card border border-border rounded-lg p-4 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading {ticker?.symbol}...</span>
            </div>
          );
        }

        return (
          <div
            key={ticker?.symbol}
            className="bg-card border border-border rounded-lg p-4 hover:border-[#00c853]/30 transition-all cursor-pointer group relative"
            style={{ boxShadow: 'var(--shadow-sm)' }}
            onClick={() => onSelectTicker?.(ticker?.symbol)}
          >
            {/* Remove button */}
            <button
              onClick={(e) => { e.stopPropagation(); onRemoveTicker?.(ticker?.symbol); }}
              className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-secondary text-muted-foreground hover:text-foreground transition-all"
            >
              <X className="w-3 h-3" />
            </button>

            {/* Header */}
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-sm text-[#00c853]">{ticker?.symbol}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleWatchlist?.(ticker?.symbol); }}
                    className="p-0.5 transition-colors"
                  >
                    <Star className={`w-3.5 h-3.5 ${isWatchlisted ? 'fill-[#ffa726] text-[#ffa726]' : 'text-muted-foreground hover:text-[#ffa726]'}`} />
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground truncate max-w-[140px]">{ticker?.name}</p>
              </div>
              {ticker?.risk && <RiskBadge score={ticker.risk.score} />}
            </div>

            {/* Price */}
            <div className="mb-3">
              <span className="font-mono text-xl font-bold text-foreground">{formatPrice(ticker?.price)}</span>
              <div className={`flex items-center gap-1 mt-0.5 ${isPositive ? 'text-[#00c853]' : 'text-[#ff1744]'}`}>
                {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                <span className="font-mono text-xs font-medium">
                  {isPositive ? '+' : ''}{ticker?.change?.toFixed?.(2) ?? '0'} ({isPositive ? '+' : ''}{ticker?.changePercent?.toFixed?.(2) ?? '0'}%)
                </span>
              </div>
            </div>

            {/* Sentiment */}
            {ticker?.sentiment && (
              <SentimentBar score={ticker.sentiment.score} label={ticker.sentiment.label} />
            )}
          </div>
        );
      })}
    </div>
  );
}
