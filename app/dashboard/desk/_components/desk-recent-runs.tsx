'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import type { DeskRunStatus, DeskSignal } from '@/lib/desk/types';

type DeskRunListItem = {
  id: string;
  tickers: string[];
  status: string;
  signal: string | null;
  createdAt: string;
};

function parseStatus(value: string): DeskRunStatus | null {
  switch (value) {
    case 'queued':
    case 'running':
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'review':
      return value;
    default:
      return null;
  }
}

function parseSignal(value: string | null): DeskSignal | null {
  switch (value) {
    case 'Buy':
    case 'Overweight':
    case 'Hold':
    case 'Underweight':
    case 'Sell':
    case 'REVIEW':
      return value;
    default:
      return null;
  }
}

function statusClass(status: DeskRunStatus): string {
  switch (status) {
    case 'queued':
    case 'cancelled':
      return 'border-border text-muted-foreground';
    case 'running':
    case 'completed':
      return 'border-[#00c853]/30 text-[#00c853]';
    case 'failed':
      return 'border-[#ff1744]/30 text-[#ff1744]';
    case 'review':
      return 'border-[#ffa726]/30 text-[#ffa726]';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function signalClass(signal: DeskSignal): string {
  switch (signal) {
    case 'Buy':
    case 'Overweight':
      return 'border-[#00c853]/30 bg-[#00c853]/10 text-[#00c853]';
    case 'Hold':
      return 'border-border bg-secondary text-muted-foreground';
    case 'Underweight':
    case 'Sell':
      return 'border-[#ff1744]/30 bg-[#ff1744]/10 text-[#ff1744]';
    case 'REVIEW':
      return 'border-[#ffa726]/30 bg-[#ffa726]/10 text-[#ffa726]';
    default: {
      const _exhaustive: never = signal;
      return _exhaustive;
    }
  }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const deltaSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (deltaSec < 60) return 'just now';
  const minutes = Math.round(deltaSec / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function DeskRecentRuns() {
  const [runs, setRuns] = useState<DeskRunListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/desk/runs', { cache: 'no-store' });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setError(typeof data?.error === 'string' ? data.error : 'Could not load runs');
          return;
        }
        setRuns(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setError('Could not load runs');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold tracking-tight">Recent runs</h2>
      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-[#00c853]" />
          Loading runs...
        </div>
      )}
      {error && <p className="text-xs text-[#ff1744]">{error}</p>}
      {!loading && !error && runs.length === 0 && (
        <p className="text-sm text-muted-foreground">No runs yet.</p>
      )}
      {!loading && !error && runs.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {runs.map((run) => {
            const status = parseStatus(run.status);
            const signal = parseSignal(run.signal);
            return (
              <li key={run.id}>
                <Link
                  href={`/dashboard/desk/runs/${run.id}`}
                  className="flex items-center gap-3 px-3 py-2.5 text-xs transition-colors hover:bg-secondary/30"
                >
                  <span className="min-w-0 flex-1 truncate font-mono font-semibold text-[#00c853]">
                    {(run.tickers ?? []).join(', ') || '—'}
                  </span>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${
                      status ? statusClass(status) : 'border-border text-muted-foreground'
                    }`}
                  >
                    {run.status}
                  </span>
                  {signal && (
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${signalClass(signal)}`}>
                      {signal}
                    </span>
                  )}
                  <span className="shrink-0 text-muted-foreground">{relativeTime(run.createdAt)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
