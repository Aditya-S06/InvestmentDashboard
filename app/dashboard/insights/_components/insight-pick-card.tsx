'use client';

import { useRouter } from 'next/navigation';
import { ExternalLink, NotebookPen, TrendingUp } from 'lucide-react';
import type { InsightPick } from '@/lib/insights/types';

interface InsightPickCardProps {
  pick: InsightPick;
  onSelectTicker: (symbol: string) => void;
}

const confidenceClass: Record<InsightPick['confidence'], string> = {
  high: 'border-[#00c853]/30 bg-[#00c853]/10 text-[#00c853]',
  medium: 'border-[#ffa726]/30 bg-[#ffa726]/10 text-[#ffa726]',
  low: 'border-[#ff1744]/30 bg-[#ff1744]/10 text-[#ff1744]',
};

export function InsightPickCard({ pick, onSelectTicker }: InsightPickCardProps) {
  const router = useRouter();

  const planPaperTrade = () => {
    sessionStorage.setItem(
      'oracle.paperTradeDraft',
      JSON.stringify({ symbol: pick.symbol, thesis: pick.thesis, signals: pick.signals }),
    );
    router.push(`/dashboard/journal?new=1&symbol=${encodeURIComponent(pick.symbol)}&source=insights`);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onSelectTicker(pick.symbol)}
          className="flex items-center gap-2 text-left"
        >
          <span className="font-mono text-lg font-bold text-[#00c853]">{pick.symbol}</span>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </button>
        <div className="flex items-center gap-2">
          {pick.inWatchlist && (
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
              Watchlist
            </span>
          )}
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${confidenceClass[pick.confidence]}`}>
            {pick.confidence}
          </span>
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-foreground">{pick.thesis}</p>

      <div className="mt-3 space-y-1.5">
        {pick.signals.map((signal) => (
          <div key={signal} className="flex gap-2 text-xs text-muted-foreground">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#00c853]" />
            <span>{signal}</span>
          </div>
        ))}
      </div>

      {(pick.sources?.length ?? 0) > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {pick.sources?.slice(0, 3).map((source) => (
            <a
              key={source}
              href={source}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              Source
              <ExternalLink className="h-3 w-3" />
            </a>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={planPaperTrade}
        className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-[#00c853]/30 bg-[#00c853]/10 px-3 py-2 text-xs font-semibold text-[#00c853] transition-colors hover:bg-[#00c853]/15"
      >
        <NotebookPen className="h-3.5 w-3.5" />
        Plan paper trade
      </button>
    </div>
  );
}

