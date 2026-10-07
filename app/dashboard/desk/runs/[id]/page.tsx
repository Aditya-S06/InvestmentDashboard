'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { DeskEventLog } from '../../_components/desk-event-log';
import { DeskMemoPane } from '../../_components/desk-memo-pane';
import { DeskReport } from '../../_components/desk-report';
import { DeskRunTimeline } from '../../_components/desk-run-timeline';
import {
  DESK_ANALYSTS,
  formatDeskTickerHeader,
  type DeskAnalyst,
  type DeskRunStatus,
  type DeskSignal,
} from '@/lib/desk/types';

import { connectDeskStream } from '@/lib/desk/stream-client';
import { deskDisplayedProgress, emptyDeskLiveState, mergeDeskRunSnapshot, reduceDeskStream } from '@/lib/desk/stream-state';

const MemoizedDeskReport = memo(DeskReport);

type DeskRunPayload = {
  id: string;
  tickers: string[];
  activeTicker: string | null;
  asOf: string;
  depth: string;
  analysts: string[];
  assetType: string;
  checkpoint: boolean;
  status: string;
  signal: string | null;
  params: unknown;
  finalState: unknown;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

// Validate the response before replacing renderable state; never echo raw server errors.
function isCancellationResponse(value: unknown, id: string): value is DeskRunPayload {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(item => typeof item === 'string');
  const nullableString = (v: unknown) => v === null || typeof v === 'string';
  return data.id === id && typeof data.status === 'string' && parseStatus(data.status) !== null
    && !isLiveStatus(parseStatus(data.status)!)
    && strings(data.tickers) && data.tickers.length > 0 && strings(data.analysts)
    && nullableString(data.activeTicker) && (data.activeTicker === null || data.tickers.includes(data.activeTicker as string))
    && ['asOf', 'depth', 'assetType', 'createdAt'].every(key => typeof data[key] === 'string')
    && typeof data.checkpoint === 'boolean' && nullableString(data.signal) && nullableString(data.error)
    && nullableString(data.finishedAt) && 'params' in data && 'finalState' in data;
}

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

function isDeskAnalyst(value: string): value is DeskAnalyst {
  return (DESK_ANALYSTS as readonly string[]).includes(value);
}

function isLiveStatus(status: DeskRunStatus): boolean {
  switch (status) {
    case 'queued':
    case 'running':
      return true;
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'review':
      return false;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
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

function formatElapsed(fromIso: string, untilIso: string | null, nowMs: number): string {
  const start = new Date(fromIso).getTime();
  if (Number.isNaN(start)) return '0:00';
  const end = untilIso ? new Date(untilIso).getTime() : nowMs;
  const sec = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function DeskRunPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [run, setRun] = useState<DeskRunPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [live, setLive] = useState(emptyDeskLiveState);
  const connectionRef = useRef<AbortController | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const cancelPendingRef = useRef(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const status = run ? parseStatus(run.status) : null;

  useEffect(() => {
    if (!id) return;
    const ac = new AbortController();
    connectionRef.current = ac;
    let tickers: string[] = [];
    setRun(null);
    setLoadError(null);
    setCancelError(null);
    setCancelling(false);
    cancelPendingRef.current = false;
    setLive(emptyDeskLiveState());
    void connectDeskStream<DeskRunPayload>({
      runId: id, signal: ac.signal,
      onRun: data => {
        if (ac.signal.aborted) return;
        tickers = data.tickers;
        setRun(current => mergeDeskRunSnapshot(current, data));
        setLoadError(null);
      },
      onEvent: event => { if (!ac.signal.aborted) setLive(current => reduceDeskStream(current, event, tickers)); },
      onError: message => { if (!ac.signal.aborted) setLoadError(message); },
    });
    return () => {
      ac.abort();
      connectionRef.current = null;
    };
  }, [id]);

  useEffect(() => {
    if (!status || !isLiveStatus(status)) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status]);

  const cancelRun = async () => {
    const signal = connectionRef.current?.signal;
    if (!id || !signal || signal.aborted || cancelPendingRef.current) return;
    cancelPendingRef.current = true;
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/desk/runs/${encodeURIComponent(id)}`, { method: 'DELETE', signal });
      if (signal.aborted) return;
      if (!res.ok) throw new Error('Cancellation request failed');
      const data: unknown = await res.json();
      if (signal.aborted) return;
      if (!isCancellationResponse(data, id)) throw new Error('Invalid cancellation response');
      setRun(current => mergeDeskRunSnapshot(current, data));
    } catch {
      if (!signal.aborted) setCancelError('Could not confirm cancellation. Check the run status and try Cancel again if it is still running.');
    } finally {
      if (!signal.aborted) { cancelPendingRef.current = false; setCancelling(false); }
    }
  };

  const analysts = useMemo(() => (run?.analysts ?? []).filter(isDeskAnalyst), [run?.analysts]);
  const signal = parseSignal(run?.signal ?? null);
  const canCancel = !!status && isLiveStatus(status);
  const progress = run && status ? deskDisplayedProgress(run, live, status) : null;
  const liveTicker = progress?.ticker;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/desk" className="text-xs text-muted-foreground hover:text-foreground">
            Trading Desk
          </Link>
          {loadError ? (
            <p className="mt-2 text-sm text-[#ff1744]">{loadError}</p>
          ) : !run || !status ? (
            <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-[#00c853]" />
              Loading run...
            </div>
          ) : (
            <>
              <div className="mt-1 font-mono text-xl font-semibold text-[#00c853]">
                {formatDeskTickerHeader(
                  run.tickers ?? [],
                  isLiveStatus(status) ? liveTicker : null,
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{run.depth}</span>
                <span>{formatElapsed(run.createdAt, run.finishedAt, nowMs)}</span>
                <span className={`rounded-full border px-2 py-0.5 ${statusClass(status)}`}>{status}</span>
                {signal && <span className="rounded-full border border-border px-2 py-0.5">{signal}</span>}
              </div>
            </>
          )}
        </div>
        {canCancel && (
          <button
            type="button"
            onClick={() => void cancelRun()}
            disabled={cancelling}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
          >
            {cancelling ? 'Cancelling...' : 'Cancel'}
          </button>
        )}
      </header>
      {cancelError && <p role="alert" className="text-sm text-[#ff1744]">{cancelError}</p>}

      {run && status && progress && (
        <>
          <DeskRunTimeline
            analysts={analysts}
            phase={progress.tickerLive.phase}
            agentStatus={progress.tickerLive.agentStatus}
            debateRound={progress.tickerLive.debateRound}
            debateSide={progress.tickerLive.debateSide}
            runStatus={progress.runStatus}
          />
          {!isLiveStatus(status) ? (
            <MemoizedDeskReport
              runId={run.id}
              activeTicker={run.activeTicker}
              tickers={run.tickers ?? []}
              asOf={run.asOf}
              depth={run.depth}
              analysts={analysts}
              assetType={run.assetType ?? 'stock'}
              checkpoint={!!run.checkpoint}
              status={status}
              signal={signal}
              params={run.params}
              finalState={run.finalState}
            />
          ) : (
            <div className="grid min-h-0 gap-4 lg:grid-cols-2">
              <DeskMemoPane agent={progress.tickerLive.memoAgent} text={progress.tickerLive.memoText} />
              <DeskEventLog lines={live.log} omitted={live.omitted} />
            </div>
          )}
          {run.error && <p className="text-sm text-[#ff1744]">{run.error}</p>}
        </>
      )}

      <p className="text-xs text-muted-foreground">Simulated research desk. Not an order. Not advice.</p>
    </main>
  );
}
