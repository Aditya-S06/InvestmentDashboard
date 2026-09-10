'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { DeskEventLog } from '../../_components/desk-event-log';
import { DeskMemoPane } from '../../_components/desk-memo-pane';
import { DeskReport } from '../../_components/desk-report';
import { DeskRunTimeline, type DeskAgentStatus } from '../../_components/desk-run-timeline';
import {
  DESK_ANALYSTS,
  formatDeskTickerHeader,
  type DeskAnalyst,
  type DeskRunStatus,
  type DeskSignal,
} from '@/lib/desk/types';

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

function logLine(event: string, data: Record<string, unknown>): string {
  switch (event) {
    case 'desk_phase':
      return `phase ${typeof data.phase === 'string' ? data.phase : ''}`;
    case 'desk_agent':
      return `agent ${typeof data.agent === 'string' ? data.agent : ''} ${typeof data.status === 'string' ? data.status : ''}`;
    case 'desk_memo':
      return `memo ${typeof data.agent === 'string' ? data.agent : ''}`;
    case 'desk_debate':
      return `debate r${typeof data.round === 'number' ? data.round : '?'} ${typeof data.side === 'string' ? data.side : ''}`;
    case 'desk_decision':
      return `decision ${typeof data.signal === 'string' ? data.signal : ''}`;
    case 'desk_done':
      return 'done';
    case 'desk_error':
      return `error ${typeof data.message === 'string' ? data.message : ''}`;
    default:
      return event;
  }
}

export default function DeskRunPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [run, setRun] = useState<DeskRunPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<Record<string, DeskAgentStatus>>({});
  const [debateRound, setDebateRound] = useState<number | null>(null);
  const [debateSide, setDebateSide] = useState<string | null>(null);
  const [memoAgent, setMemoAgent] = useState<string | null>(null);
  const [memoText, setMemoText] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [cancelling, setCancelling] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const status = run ? parseStatus(run.status) : null;

  useEffect(() => {
    if (!id) return;
    const ac = new AbortController();
    let cancelled = false;

    async function boot() {
      try {
        const res = await fetch(`/api/desk/runs/${id}`, { cache: 'no-store', signal: ac.signal });
        const data = (await res.json().catch(() => ({}))) as DeskRunPayload & { error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(typeof data?.error === 'string' ? data.error : 'Could not load run');
          return;
        }
        setRun(data);
        setLoadError(null);
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        setLoadError('Could not load run');
        return;
      }

      try {
        const streamRes = await fetch(`/api/desk/runs/${id}/stream`, { signal: ac.signal });
        if (!streamRes.ok) return;
        await readEventStream(streamRes, async (event, data) => {
          if (cancelled) return;
          const row = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
          setLog((current) => [...current, logLine(event, row)]);
          applySseEvent(event, row, {
            setPhase,
            setAgentStatus,
            setDebateRound,
            setDebateSide,
            setMemoAgent,
            setMemoText,
            setRun,
          });
        });
        if (cancelled) return;
        const latest = await fetch(`/api/desk/runs/${id}`, { cache: 'no-store' });
        const payload = (await latest.json().catch(() => null)) as DeskRunPayload | null;
        if (payload && typeof payload.status === 'string') setRun(payload);
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
      }
    }

    void boot();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [id]);

  useEffect(() => {
    if (!status || !isLiveStatus(status)) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (!id || !status || !isLiveStatus(status)) return;
    const timer = setInterval(() => {
      void fetch(`/api/desk/runs/${id}`, { cache: 'no-store' })
        .then(async (res) => {
          const payload = (await res.json().catch(() => null)) as DeskRunPayload | null;
          if (payload && typeof payload.status === 'string') setRun(payload);
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [id, status]);

  const lastTickerRef = useRef<string | null>(null);
  useEffect(() => {
    const next = run?.activeTicker ?? null;
    if (lastTickerRef.current && next && lastTickerRef.current !== next) {
      setPhase(null);
      setAgentStatus({});
      setDebateRound(null);
      setDebateSide(null);
      setMemoAgent(null);
      setMemoText('');
    }
    lastTickerRef.current = next;
  }, [run?.activeTicker]);

  const cancelRun = async () => {
    if (!id) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/desk/runs/${id}`, { method: 'DELETE' });
      const data = (await res.json().catch(() => null)) as DeskRunPayload | null;
      if (data && typeof data.status === 'string') setRun(data);
    } finally {
      setCancelling(false);
    }
  };

  const analysts = (run?.analysts ?? []).filter(isDeskAnalyst);
  const signal = parseSignal(run?.signal ?? null);
  const canCancel = !!status && isLiveStatus(status);

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
                  isLiveStatus(status) ? run.activeTicker : null,
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

      {run && status && (
        <>
          <DeskRunTimeline
            analysts={analysts}
            phase={phase}
            agentStatus={agentStatus}
            debateRound={debateRound}
            debateSide={debateSide}
            runStatus={status}
          />
          {status === 'completed' || status === 'review' ? (
            <DeskReport
              runId={run.id}
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
              <DeskMemoPane agent={memoAgent} text={memoText} />
              <DeskEventLog lines={log} />
            </div>
          )}
          {run.error && <p className="text-sm text-[#ff1744]">{run.error}</p>}
        </>
      )}

      <p className="text-xs text-muted-foreground">Simulated research desk. Not an order. Not advice.</p>
    </main>
  );
}

type SseSetters = {
  setPhase: (value: string | null) => void;
  setAgentStatus: (update: (current: Record<string, DeskAgentStatus>) => Record<string, DeskAgentStatus>) => void;
  setDebateRound: (value: number | null) => void;
  setDebateSide: (value: string | null) => void;
  setMemoAgent: (value: string | null) => void;
  setMemoText: (value: string) => void;
  setRun: (update: (current: DeskRunPayload | null) => DeskRunPayload | null) => void;
};

function applySseEvent(event: string, data: Record<string, unknown>, setters: SseSetters) {
  switch (event) {
    case 'desk_phase':
      if (typeof data.phase === 'string') setters.setPhase(data.phase);
      if (typeof data.ticker === 'string') {
        setters.setRun((current) => (current ? { ...current, activeTicker: data.ticker as string } : current));
      }
      return;
    case 'desk_agent': {
      const agent = typeof data.agent === 'string' ? data.agent : null;
      const agentState = data.status === 'done' ? 'done' : data.status === 'start' ? 'running' : null;
      if (agent && agentState) {
        setters.setAgentStatus((current) => ({ ...current, [agent]: agentState }));
      }
      return;
    }
    case 'desk_memo':
      setters.setMemoAgent(typeof data.agent === 'string' ? data.agent : null);
      setters.setMemoText(typeof data.text === 'string' ? data.text : '');
      return;
    case 'desk_debate':
      if (typeof data.round === 'number') setters.setDebateRound(data.round);
      if (typeof data.side === 'string') {
        setters.setDebateSide(data.side);
        setters.setMemoAgent(data.side);
      }
      setters.setMemoText(typeof data.text === 'string' ? data.text : '');
      return;
    case 'desk_decision':
      if (typeof data.signal === 'string') {
        setters.setRun((current) => (current ? { ...current, signal: data.signal as string } : current));
      }
      return;
    case 'desk_done':
      return;
    case 'desk_error':
      setters.setRun((current) =>
        current
          ? {
              ...current,
              status: 'failed',
              error: typeof data.message === 'string' ? data.message : current.error,
            }
          : current,
      );
      return;
    default:
      return;
  }
}

async function readEventStream(response: Response, onEvent: (event: string, data: unknown) => Promise<void> | void) {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const parsed = parseSseEvent(part);
      if (parsed) await onEvent(parsed.name, parsed.data);
    }
  }

  if (buffer.trim()) {
    const parsed = parseSseEvent(buffer);
    if (parsed) await onEvent(parsed.name, parsed.data);
  }
}

function parseSseEvent(raw: string): { name: string; data: unknown } | null {
  const lines = raw.split(/\r?\n/);
  const name = lines.find((line) => line.startsWith('event:'))?.replace(/^event:\s*/, '').trim();
  const dataLines = lines.filter((line) => line.startsWith('data:')).map((line) => line.replace(/^data:\s*/, ''));
  if (!name) return null;

  try {
    return { name, data: JSON.parse(dataLines.join('\n') || '{}') };
  } catch {
    return { name, data: {} };
  }
}
