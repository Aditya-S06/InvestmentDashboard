export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 600;

import { NextRequest, NextResponse } from 'next/server';
import { requireDeskAccess } from '@/lib/desk/access';
import { deskResultsDir } from '@/lib/desk/config';
import {
  deskEventsPath,
  finalizeDeskRun,
  followDeskJsonl,
  isTerminalDeskStatus,
  jsonlToSseName,
  parseDeskRunStatus,
  validateDeskArtifactPaths,
} from '@/lib/desk/runner';
import { deskCursorScope, InvalidDeskCursor, validateDeskCursor } from '@/lib/desk/stream-file';
import { prisma } from '@/lib/prisma';
import { DESK_RECONCILE_FRESH_MS } from '@/lib/desk/limits';

interface RouteContext {
  params: { id: string };
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const auth = await requireDeskAccess();
  if (auth instanceof NextResponse) return auth;

  const run = await prisma.deskRun.findFirst({
    where: { id: params.id, userId: auth.userId },
    select: { id: true, userId: true, status: true },
  });
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  validateDeskArtifactPaths(run.userId, run.id);
  const eventsPath = deskEventsPath(deskResultsDir(run.userId, run.id));
  const scope = deskCursorScope(run.userId, run.id);
  const query = req.nextUrl.searchParams.getAll('after');
  const header = req.headers.get('Last-Event-ID');
  if (query.length > 1 || (query.length && header !== null && query[0] !== header)) {
    return NextResponse.json({ error: 'Conflicting Desk stream cursors' }, { status: 400 });
  }
  const after = query[0] ?? header;
  try { validateDeskCursor(eventsPath, scope, after); } catch (error) {
    if (error instanceof InvalidDeskCursor) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
  const encoder = new TextEncoder();
  const connection = new AbortController();
  const { id: runId, userId } = run;
  const frame = (event: string, data: unknown, id?: string) =>
    encoder.encode(`${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  async function* frames() {
      let terminalStatus: string | null = null;
      let checkedAt = -Infinity;
      try {
        for await (const record of followDeskJsonl(eventsPath, {
          scope, after, signal: connection.signal,
          isFinished: async () => {
            if (performance.now() - checkedAt < DESK_RECONCILE_FRESH_MS) return false;
            checkedAt = performance.now();
            await finalizeDeskRun(runId, userId);
            const current = await prisma.deskRun.findFirst({
              where: { id: runId, userId },
              select: { status: true },
            });
            const status = current ? parseDeskRunStatus(current.status) : null;
            if (!current) throw new Error('Run no longer available');
            terminalStatus = status && isTerminalDeskStatus(status) ? status : null;
            return terminalStatus !== null;
          },
        })) {
          const row = record.data;
          const kind = typeof row.event === 'string' ? row.event : '';
          const sseName = jsonlToSseName(kind);
          if (!sseName) continue;
          yield frame(sseName, row, record.id);
          // Per-ticker `done` is not run-terminal; sequential tickers keep appending.
        }
        // Control message has no replay ID; only persisted JSONL records advance it.
        if (terminalStatus && !connection.signal.aborted) yield frame('desk_status', { status: terminalStatus });
      } finally {
        req.signal.removeEventListener('abort', abort);
      }
  }
  const iterator = frames();
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  const abort = () => {
    connection.abort();
    req.signal.removeEventListener('abort', abort);
    // Also release the generator's file handle when paused at a yielded record.
    void iterator.return(undefined).catch(() => {});
    try { streamController?.close(); } catch { /* already cancelled */ }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      if (req.signal.aborted) abort();
      else req.signal.addEventListener('abort', abort, { once: true });
    },
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (connection.signal.aborted) return;
        if (next.done) controller.close(); else controller.enqueue(next.value);
      } catch (error) {
        if (!connection.signal.aborted) controller.error(error);
        abort();
      }
    },
    cancel() {
      // Dropping SSE must not kill the detached Python child.
      abort();
      return iterator.return(undefined).then(() => {});
    },
  }, { highWaterMark: 0 }); // No speculative replay; one frame per consumer pull.

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
