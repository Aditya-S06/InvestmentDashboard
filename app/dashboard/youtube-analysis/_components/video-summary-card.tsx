'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, FileText, Loader2 } from 'lucide-react';

export interface VideoSummaryItem {
  id: string;
  videoId: string;
  title: string;
  channelHandle: string;
  publishedAt: string;
  url: string;
  transcriptLength: number;
  summary: {
    key_thesis?: string;
    signals?: string[];
    risks?: string[];
    timestamped_highlights?: string[];
    stock_mentions?: string[];
    macro_relevance?: string;
    confidence?: 'high' | 'medium' | 'low' | string;
  } | null;
  stockMentions: string[];
  rawTranscriptSnippet?: string | null;
}

const confidenceColor: Record<string, string> = {
  high: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  medium: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  low: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
};

interface Props {
  item: VideoSummaryItem;
  onSelectTicker?: (symbol: string) => void;
  onResummarize?: (payload: {
    videoId: string;
    url: string;
    transcript: string;
    title?: string;
    channel?: string;
  }) => Promise<void>;
  resummarizing?: boolean;
}

export function VideoSummaryCard({ item, onSelectTicker, onResummarize, resummarizing }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [localBusy, setLocalBusy] = useState(false);

  const summary = item.summary ?? {};
  const confidence = String(summary.confidence || 'low').toLowerCase();
  const weakThesis =
    !summary.key_thesis ||
    /unable to extract|summarization skipped|limited summary/i.test(summary.key_thesis);

  const tickers = useMemo(() => {
    const fromSummary = Array.isArray(summary.stock_mentions) ? summary.stock_mentions : [];
    const merged = [...new Set([...(item.stockMentions || []), ...fromSummary].map((t) => t.toUpperCase()))];
    return merged;
  }, [item.stockMentions, summary.stock_mentions]);

  const published = (() => {
    try {
      return new Date(item.publishedAt).toLocaleString();
    } catch {
      return item.publishedAt;
    }
  })();

  const busy = resummarizing || localBusy;

  const submitTranscript = async () => {
    if (!onResummarize || !transcript.trim() || busy) return;
    setLocalBusy(true);
    try {
      await onResummarize({
        videoId: item.videoId,
        url: item.url,
        transcript: transcript.trim(),
        title: item.title,
        channel: item.channelHandle,
      });
      setShowPaste(false);
      setTranscript('');
      setExpanded(true);
    } finally {
      setLocalBusy(false);
    }
  };

  return (
    <article className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{item.channelHandle}</span>
            <span>·</span>
            <span>{published}</span>
            <span
              className={`px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wide ${
                confidenceColor[confidence] || confidenceColor.low
              }`}
            >
              {confidence}
            </span>
          </div>
          <h3 className="font-medium text-sm leading-snug line-clamp-2">{item.title}</h3>
        </div>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
          title="Open on YouTube"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>

      {summary.key_thesis && (
        <p className="text-sm text-muted-foreground leading-relaxed">{summary.key_thesis}</p>
      )}

      {weakThesis && (
        <p className="text-[11px] text-amber-400/90">
          Weak or missing thesis — paste a transcript below to re-summarize.
        </p>
      )}

      {tickers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tickers.map((sym) => (
            <button
              key={sym}
              type="button"
              onClick={() => onSelectTicker?.(sym)}
              className="px-2 py-0.5 rounded-md text-xs font-mono bg-[#00c853]/10 text-[#00c853] border border-[#00c853]/25 hover:bg-[#00c853]/20 transition-colors"
            >
              {sym}
            </button>
          ))}
        </div>
      )}

      {Array.isArray(summary.signals) && summary.signals.length > 0 && (
        <ul className="space-y-1">
          {summary.signals.slice(0, expanded ? undefined : 3).map((signal, idx) => (
            <li key={idx} className="text-xs text-foreground/90 flex gap-2">
              <span className="text-[#00c853] shrink-0">●</span>
              <span>{signal}</span>
            </li>
          ))}
        </ul>
      )}

      {expanded && (
        <div className="space-y-3 pt-1 border-t border-border">
          {summary.macro_relevance && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Macro relevance</p>
              <p className="text-xs text-foreground/90">{summary.macro_relevance}</p>
            </div>
          )}
          {Array.isArray(summary.risks) && summary.risks.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Risks</p>
              <ul className="space-y-1">
                {summary.risks.map((risk, idx) => (
                  <li key={idx} className="text-xs text-amber-400/90 flex gap-2">
                    <span className="shrink-0">⚠</span>
                    <span>{risk}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {Array.isArray(summary.timestamped_highlights) && summary.timestamped_highlights.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Highlights</p>
              <ul className="space-y-1">
                {summary.timestamped_highlights.map((h, idx) => (
                  <li key={idx} className="text-xs font-mono text-muted-foreground">
                    {h}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {item.rawTranscriptSnippet && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Transcript snippet</p>
              <p className="text-xs text-muted-foreground italic line-clamp-4">{item.rawTranscriptSnippet}</p>
            </div>
          )}
        </div>
      )}

      {showPaste && onResummarize && (
        <div className="space-y-2 pt-1 border-t border-border">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Paste transcript</p>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={8}
            placeholder="Paste captions / transcript text, then summarize…"
            className="w-full px-2 py-1.5 text-xs rounded-md bg-background border border-border font-mono resize-y focus:outline-none focus:ring-1 focus:ring-[#00c853]/50"
          />
          <button
            type="button"
            onClick={submitTranscript}
            disabled={busy || transcript.trim().length < 40}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-medium bg-[#00c853]/15 text-[#00c853] border border-[#00c853]/30 hover:bg-[#00c853]/25 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            Summarize with this transcript
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" /> Collapse
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" /> Expand details
            </>
          )}
        </button>
        {onResummarize && (
          <button
            type="button"
            onClick={() => setShowPaste((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            {showPaste ? 'Hide paste' : 'Paste transcript'}
          </button>
        )}
      </div>
    </article>
  );
}
