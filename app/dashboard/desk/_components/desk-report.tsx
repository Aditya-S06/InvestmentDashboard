'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Loader2, RefreshCw, Sparkles, Star } from 'lucide-react';
import { toast } from 'sonner';
import { InsightMarkdown } from '../../insights/_components/insight-markdown';
import {
  DESK_REPORT_TABS,
  createInputFromDeskRun,
  parseDeskReport,
  resolveDeskRating,
  type DeskReportTab,
} from '@/lib/desk/report';
import type { DeskAnalyst, DeskSignal } from '@/lib/desk/types';
import { useWatchlist } from '../../_components/watchlist-provider';

type DeskReportProps = {
  runId: string;
  tickers: string[];
  asOf: string;
  depth: string;
  analysts: DeskAnalyst[];
  assetType: string;
  checkpoint: boolean;
  status: 'completed' | 'review';
  signal: DeskSignal | null;
  params: unknown;
  finalState: unknown;
};

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

function Memo({ title, text }: { title: string; text: string }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="border-b border-border px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        {title}
      </header>
      <div className="px-3 py-3">
        {text.trim() ? (
          <InsightMarkdown content={text} />
        ) : (
          <p className="text-sm text-muted-foreground">No memo from this analyst.</p>
        )}
      </div>
    </section>
  );
}

function TabPanel({
  tab,
  analysts,
  report,
}: {
  tab: Exclude<DeskReportTab, 'overview'>;
  analysts: DeskAnalyst[];
  report: ReturnType<typeof parseDeskReport>;
}) {
  switch (tab) {
    case 'analysts':
      return (
        <div className="space-y-4">
          {analysts.includes('market') && <Memo title="Market" text={report.marketReport} />}
          {analysts.includes('social') && <Memo title="Social" text={report.sentimentReport} />}
          {analysts.includes('news') && <Memo title="News" text={report.newsReport} />}
          {analysts.includes('fundamentals') && <Memo title="Fundamentals" text={report.fundamentalsReport} />}
          {analysts.length === 0 && <p className="text-sm text-muted-foreground">No analysts selected.</p>}
        </div>
      );
    case 'debate':
      return (
        <div className="space-y-4">
          <Memo title="Bull" text={report.bullHistory} />
          <Memo title="Bear" text={report.bearHistory} />
          <Memo title="Research manager" text={report.researchPlan} />
        </div>
      );
    case 'trader':
      return <Memo title="Trader proposal" text={report.traderPlan} />;
    case 'risk':
      return (
        <div className="space-y-4">
          <Memo title="Aggressive" text={report.aggressiveHistory} />
          <Memo title="Conservative" text={report.conservativeHistory} />
          <Memo title="Neutral" text={report.neutralHistory} />
          <Memo title="Judge" text={report.riskJudge} />
        </div>
      );
    case 'decision':
      return <Memo title="Portfolio / final trade decision" text={report.finalDecision} />;
    default: {
      const _exhaustive: never = tab;
      return _exhaustive;
    }
  }
}

async function downloadFile(runId: string, format: 'md' | 'zip') {
  const res = await fetch(`/api/desk/runs/${runId}/download?format=${format}`);
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? 'Download failed');
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const matched = disposition.match(/filename="([^"]+)"/);
  const filename = matched?.[1] ?? `desk-report.${format}`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function DeskReport({
  runId,
  tickers,
  asOf,
  depth,
  analysts,
  assetType,
  checkpoint,
  status,
  signal,
  params,
  finalState,
}: DeskReportProps) {
  const router = useRouter();
  const { watchlist, toggleWatchlist } = useWatchlist();
  const [tab, setTab] = useState<DeskReportTab>('overview');
  const [busy, setBusy] = useState<string | null>(null);

  const fallbackTicker = (tickers[0] ?? '').toUpperCase();
  const report = useMemo(() => parseDeskReport(finalState, fallbackTicker), [finalState, fallbackTicker]);
  const rating = resolveDeskRating(signal, report, status);
  const ticker = report.ticker || fallbackTicker;
  const onWatchlist = watchlist.some((item) => item.ticker === ticker);
  const rerunInput = createInputFromDeskRun(params, {
    tickers,
    asOf,
    depth,
    analysts,
    assetType,
    checkpoint,
  });

  const addTicker = async () => {
    if (!ticker || onWatchlist) return;
    setBusy('watchlist');
    try {
      await toggleWatchlist(ticker);
    } finally {
      setBusy(null);
    }
  };

  const sendToInsights = async () => {
    setBusy('insights');
    try {
      const res = await fetch(`/api/desk/runs/${runId}/insights`, { method: 'POST' });
      const data = (await res.json().catch(() => null)) as { sessionId?: string; error?: string } | null;
      if (!res.ok || !data?.sessionId) {
        toast.error(data?.error ?? 'Could not send to Insights');
        return;
      }
      toast.success('Opened in Insights');
      router.push(`/dashboard/insights?session=${data.sessionId}`);
    } catch {
      toast.error('Could not send to Insights');
    } finally {
      setBusy(null);
    }
  };

  const download = async (format: 'md' | 'zip') => {
    setBusy(format);
    try {
      await downloadFile(runId, format);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Download failed');
    } finally {
      setBusy(null);
    }
  };

  const rerun = async () => {
    if (!rerunInput) {
      toast.error('This run cannot be cloned');
      return;
    }
    setBusy('rerun');
    try {
      const res = await fetch('/api/desk/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rerunInput),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok || !data?.id) {
        toast.error(data?.error ?? 'Could not re-run');
        return;
      }
      router.push(`/dashboard/desk/runs/${data.id}`);
    } catch {
      toast.error('Could not re-run');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Report</span>
          {rating && (
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${signalClass(rating)}`}>
              {rating}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => void addTicker()}
            disabled={!ticker || onWatchlist || busy === 'watchlist'}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
          >
            {busy === 'watchlist' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Star className="h-3 w-3" />}
            {onWatchlist ? `On watchlist` : `Add ${ticker || 'ticker'}`}
          </button>
          <button
            type="button"
            onClick={() => void sendToInsights()}
            disabled={busy === 'insights'}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
          >
            {busy === 'insights' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Send to Insights
          </button>
          <button
            type="button"
            onClick={() => void download('md')}
            disabled={busy === 'md'}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
          >
            {busy === 'md' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            Markdown
          </button>
          <button
            type="button"
            onClick={() => void download('zip')}
            disabled={busy === 'zip'}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
          >
            {busy === 'zip' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            Zip
          </button>
          <button
            type="button"
            onClick={() => void rerun()}
            disabled={!rerunInput || busy === 'rerun'}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
          >
            {busy === 'rerun' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Re-run
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-1 border-b border-border px-2">
        {DESK_REPORT_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
              tab === item.id
                ? 'border-[#00c853] text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="p-4">
        {tab === 'overview' ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-lg font-semibold text-[#00c853]">{ticker || '—'}</span>
              {rating && (
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${signalClass(rating)}`}>
                  {rating}
                </span>
              )}
            </div>
            {report.executiveSummary ? (
              <div>
                <h3 className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Executive summary</h3>
                <p className="text-sm leading-relaxed text-foreground">{report.executiveSummary}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No executive summary in this run.</p>
            )}
            {(report.horizon || report.entry || report.stop || report.sizing) && (
              <dl className="grid gap-3 sm:grid-cols-2">
                {report.horizon && (
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Horizon</dt>
                    <dd className="text-sm">{report.horizon}</dd>
                  </div>
                )}
                {report.entry && (
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Entry</dt>
                    <dd className="text-sm">{report.entry}</dd>
                  </div>
                )}
                {report.stop && (
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Stop</dt>
                    <dd className="text-sm">{report.stop}</dd>
                  </div>
                )}
                {report.sizing && (
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Sizing</dt>
                    <dd className="text-sm">{report.sizing}</dd>
                  </div>
                )}
              </dl>
            )}
            {(report.bullExcerpt || report.bearExcerpt) && (
              <div className="grid gap-3 lg:grid-cols-2">
                {report.bullExcerpt && (
                  <blockquote className="rounded-md border border-[#00c853]/20 bg-[#00c853]/5 p-3">
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-[#00c853]">Bull</div>
                    <p className="text-sm leading-relaxed text-foreground/90">{report.bullExcerpt}</p>
                  </blockquote>
                )}
                {report.bearExcerpt && (
                  <blockquote className="rounded-md border border-[#ff1744]/20 bg-[#ff1744]/5 p-3">
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-[#ff1744]">Bear</div>
                    <p className="text-sm leading-relaxed text-foreground/90">{report.bearExcerpt}</p>
                  </blockquote>
                )}
              </div>
            )}
          </div>
        ) : (
          <TabPanel tab={tab} analysts={analysts} report={report} />
        )}
      </div>
    </section>
  );
}
