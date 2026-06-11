'use client';

import { useState } from 'react';
import { Star, TrendingUp, TrendingDown, Bookmark, ChevronDown, ChevronRight } from 'lucide-react';
import type { TickerCardData, WatchlistItem } from '@/lib/types';
import { groupWatchlistBySector } from '@/lib/watchlist-sectors';

interface WatchlistSidebarProps {
  watchlist: WatchlistItem[];
  prices: Record<string, TickerCardData>;
  onSelectTicker: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}

function WatchlistRow({
  item,
  data,
  onSelectTicker,
  onRemove,
}: {
  item: WatchlistItem;
  data?: TickerCardData;
  onSelectTicker: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}) {
  const isPositive = (data?.change ?? 0) >= 0;

  return (
    <div
      className="flex items-center justify-between px-4 py-2 hover:bg-secondary/50 cursor-pointer border-b border-border/20 transition-colors"
      onClick={() => onSelectTicker?.(item?.ticker)}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-mono font-semibold text-xs text-[#00c853]">{item?.ticker}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove?.(item?.ticker);
            }}
            className="p-0.5"
          >
            <Star className="w-3 h-3 fill-[#ffa726] text-[#ffa726]" />
          </button>
        </div>
        {data?.name && <p className="text-[9px] text-muted-foreground truncate">{data.name}</p>}
      </div>
      <div className="text-right shrink-0 ml-2">
        <p className="font-mono text-xs font-medium">{data?.price ? `$${data.price.toFixed(2)}` : '—'}</p>
        {data && (
          <p
            className={`font-mono text-[10px] flex items-center gap-0.5 justify-end ${isPositive ? 'text-[#00c853]' : 'text-[#ff1744]'}`}
          >
            {isPositive ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
            {isPositive ? '+' : ''}
            {data?.changePercent?.toFixed?.(2) ?? '0'}%
          </p>
        )}
      </div>
    </div>
  );
}

export function WatchlistSidebar({ watchlist, prices, onSelectTicker, onRemove }: WatchlistSidebarProps) {
  const sectors = groupWatchlistBySector(watchlist ?? []);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleSector = (sector: string) => {
    setCollapsed((prev) => ({ ...prev, [sector]: !prev[sector] }));
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <Bookmark className="w-4 h-4 text-[#ffa726]" />
        <h3 className="text-sm font-display font-semibold">Watchlist</h3>
        <span className="text-[10px] text-muted-foreground ml-auto font-mono">
          {watchlist?.length ?? 0} · {sectors.length} sectors
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {(watchlist?.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 px-4 gap-2">
            <Star className="w-8 h-8 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground text-center">
              Loading sector baskets… refresh the page if this stays empty.
            </p>
          </div>
        ) : (
          sectors.map(({ sector, items }) => {
            const isCollapsed = collapsed[sector];
            return (
              <div key={sector} className="border-b border-border/40">
                <button
                  type="button"
                  onClick={() => toggleSector(sector)}
                  className="w-full flex items-start gap-2 px-3 py-2.5 bg-secondary/30 hover:bg-secondary/50 text-left transition-colors"
                >
                  {isCollapsed ? (
                    <ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#60B5FF]" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold text-[#60B5FF] leading-snug">{sector}</p>
                    <p className="text-[9px] text-muted-foreground font-mono mt-0.5">{items.length} tickers</p>
                  </div>
                </button>
                {!isCollapsed &&
                  items.map((item) => (
                    <WatchlistRow
                      key={item.id}
                      item={item}
                      data={prices?.[item.ticker]}
                      onSelectTicker={onSelectTicker}
                      onRemove={onRemove}
                    />
                  ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
