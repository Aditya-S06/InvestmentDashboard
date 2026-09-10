'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, X } from 'lucide-react';
import {
  DESK_ANALYSTS,
  DESK_ASSET_TYPES,
  DESK_DEPTHS,
  type CreateDeskRunInput,
  type DeskAnalyst,
  type DeskAssetType,
  type DeskDepth,
} from '@/lib/desk/types';
import { useWatchlist } from '../../_components/watchlist-provider';

const MAX_TICKERS = 3;

const ANALYST_LABEL: Record<DeskAnalyst, string> = {
  market: 'Market',
  social: 'Social',
  news: 'News',
  fundamentals: 'Fundamentals',
};

function americaNewYorkToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function chipClass(active: boolean) {
  return `rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
    active
      ? 'bg-[#00c853]/15 text-[#00c853]'
      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
  }`;
}

export function DeskLaunchForm() {
  const router = useRouter();
  const { watchlist, loadingWatchlist } = useWatchlist();
  const [tickers, setTickers] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [asOf, setAsOf] = useState(americaNewYorkToday);
  const [depth, setDepth] = useState<DeskDepth>('standard');
  const [analysts, setAnalysts] = useState<DeskAnalyst[]>([...DESK_ANALYSTS]);
  const [assetType, setAssetType] = useState<DeskAssetType>('stock');
  const [checkpoint, setCheckpoint] = useState(false);
  const [resumable, setResumable] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tickers.length === 0) {
      setResumable([]);
      return;
    }
    let cancelled = false;
    const query = new URLSearchParams({ tickers: tickers.join(',') });
    void fetch(`/api/desk/checkpoints?${query}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { tickers?: unknown } | null;
        if (cancelled || !res.ok) return;
        const listed = data?.tickers;
        const next = Array.isArray(listed)
          ? listed.filter((item): item is string => typeof item === 'string')
          : [];
        setResumable(next);
      })
      .catch(() => {
        if (!cancelled) setResumable([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tickers]);

  const addTicker = (raw: string) => {
    const symbol = raw.trim().toUpperCase();
    if (!symbol || tickers.includes(symbol) || tickers.length >= MAX_TICKERS) return;
    if (symbol.length > 10) {
      setError('Ticker must be 10 characters or fewer');
      return;
    }
    setError(null);
    setTickers([...tickers, symbol]);
    setDraft('');
  };

  const fillWatchlist = () => {
    const next = watchlist.slice(0, MAX_TICKERS).map((item) => item.ticker.toUpperCase());
    if (next.length === 0) {
      setError('Watchlist is empty');
      return;
    }
    setError(null);
    setTickers(next);
    setDraft('');
  };

  const clearCheckpoint = async (ticker: string) => {
    setError(null);
    try {
      const res = await fetch('/api/desk/checkpoints', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data?.error === 'string' ? data.error : 'Could not clear checkpoint');
        return;
      }
      setResumable((current) => current.filter((item) => item !== ticker));
    } catch {
      setError('Could not clear checkpoint');
    }
  };

  const setAsset = (next: DeskAssetType) => {
    setAssetType(next);
    switch (next) {
      case 'crypto':
        setAnalysts((current) => current.filter((analyst) => analyst !== 'fundamentals'));
        return;
      case 'stock':
        return;
      default: {
        const _exhaustive: never = next;
        return _exhaustive;
      }
    }
  };

  const toggleAnalyst = (analyst: DeskAnalyst) => {
    if (analyst === 'fundamentals' && assetType === 'crypto') return;
    setAnalysts((current) => {
      const next = new Set(current);
      if (next.has(analyst)) next.delete(analyst);
      else next.add(analyst);
      return DESK_ANALYSTS.filter((key) => next.has(key));
    });
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const pending = draft.trim().toUpperCase();
    const nextTickers = [...tickers];
    if (pending && !nextTickers.includes(pending) && nextTickers.length < MAX_TICKERS && pending.length <= 10) {
      nextTickers.push(pending);
    }
    const payload: CreateDeskRunInput = {
      tickers: nextTickers,
      asOf,
      depth,
      analysts: assetType === 'crypto' ? analysts.filter((analyst) => analyst !== 'fundamentals') : analysts,
      assetType,
      checkpoint,
    };
    if (payload.tickers.length < 1 || payload.tickers.length > MAX_TICKERS) {
      setError('Add 1 to 3 tickers');
      return;
    }
    if (payload.analysts.length < 1) {
      setError('Select at least one analyst');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/desk/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        const remaining = typeof data?.remaining === 'number' ? data.remaining : 0;
        const bucket = typeof data?.bucket === 'string' ? data.bucket : 'desk';
        setError(
          typeof data?.error === 'string'
            ? data.error
            : `Trading Desk rate limit reached (bucket=${bucket}, remaining=${remaining})`,
        );
        return;
      }
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Could not start run');
        return;
      }
      if (typeof data?.id !== 'string') {
        setError('Could not start run');
        return;
      }
      router.push(`/dashboard/desk/runs/${data.id}`);
    } catch {
      setError('Could not start run');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-border bg-card p-4">
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Tickers</span>
            <button
              type="button"
              onClick={fillWatchlist}
              disabled={loadingWatchlist}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              Use watchlist
            </button>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {tickers.map((ticker) => (
              <span
                key={ticker}
                className="inline-flex items-center gap-1 rounded-md border border-[#00c853]/30 bg-[#00c853]/10 px-2 py-1 font-mono text-xs font-semibold text-[#00c853]"
              >
                {ticker}
                <button
                  type="button"
                  aria-label={`Remove ${ticker}`}
                  onClick={() => setTickers(tickers.filter((item) => item !== ticker))}
                  className="text-[#00c853]/70 hover:text-[#00c853]"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {tickers.length < MAX_TICKERS && (
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value.toUpperCase())}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addTicker(draft);
                  }
                }}
                onBlur={() => addTicker(draft)}
                placeholder="AAPL"
                className="w-24 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm uppercase outline-none focus:border-[#00c853]"
              />
            )}
          </div>
        </div>

        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">As of</span>
          <input
            type="date"
            value={asOf}
            onChange={(event) => setAsOf(event.target.value)}
            className="mt-1.5 block rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-[#00c853]"
          />
        </label>

        <div>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Depth</span>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {DESK_DEPTHS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={depth === option}
                onClick={() => setDepth(option)}
                className={chipClass(depth === option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <fieldset>
          <legend className="text-[10px] uppercase tracking-wide text-muted-foreground">Analysts</legend>
          <div className="mt-1.5 flex flex-wrap gap-3">
            {DESK_ANALYSTS.map((analyst) => {
              const fundamentalsLocked = analyst === 'fundamentals' && assetType === 'crypto';
              return (
                <label
                  key={analyst}
                  className={`flex items-center gap-1.5 text-xs ${fundamentalsLocked ? 'text-muted-foreground/50' : 'text-foreground'}`}
                >
                  <input
                    type="checkbox"
                    checked={analysts.includes(analyst)}
                    disabled={fundamentalsLocked}
                    onChange={() => toggleAnalyst(analyst)}
                    className="accent-[#00c853]"
                  />
                  {ANALYST_LABEL[analyst]}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Asset</span>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {DESK_ASSET_TYPES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={assetType === option}
                onClick={() => setAsset(option)}
                className={chipClass(assetType === option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={checkpoint}
            onChange={(event) => setCheckpoint(event.target.checked)}
            className="accent-[#00c853]"
          />
          Checkpoint
        </label>

        {resumable.length > 0 && (
          <div className="space-y-1.5 rounded-md border border-border px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Saved checkpoints</p>
            {resumable.map((ticker) => (
              <div key={ticker} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono text-[#00c853]">{ticker}</span>
                <button
                  type="button"
                  onClick={() => setCheckpoint(true)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Resume
                </button>
                <button
                  type="button"
                  onClick={() => void clearCheckpoint(ticker)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Clear checkpoint
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-xs text-[#ff1744]">{error}</p>}

      <button
        type="submit"
        disabled={
          submitting ||
          analysts.length === 0 ||
          (tickers.length === 0 && (draft.trim().length === 0 || draft.trim().length > 10))
        }
        className="mt-4 inline-flex items-center gap-2 rounded-md bg-[#00c853] px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
      >
        {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Launch
      </button>
    </form>
  );
}
