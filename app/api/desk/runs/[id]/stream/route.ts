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
  reapOrphanDeskRuns,
} from '@/lib/desk/runner';
import { prisma } from '@/lib/prisma';

interface RouteContext {
  params: { id: string };
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const auth = await requireDeskAccess();
  if (auth instanceof NextResponse) return auth;

  await reapOrphanDeskRuns(auth.userId);

  const run = await prisma.deskRun.findFirst({
    where: { id: params.id, userId: auth.userId },
    select: { id: true, userId: true, status: true },
  });
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const eventsPath = deskEventsPath(deskResultsDir(run.userId, run.id));
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        for await (const row of followDeskJsonl(eventsPath, {
          signal: req.signal,
          isFinished: async () => {
            const current = await prisma.deskRun.findFirst({
              where: { id: run.id, userId: run.userId },
              select: { status: true },
            });
            const status = current ? parseDeskRunStatus(current.status) : null;
            return !!status && isTerminalDeskStatus(status);
          },
        })) {
          const kind = typeof row.event === 'string' ? row.event : '';
          const sseName = jsonlToSseName(kind);
          if (!sseName) continue;
          send(sseName, row);
          if (kind === 'error') {
            await finalizeDeskRun(run.id, run.userId);
          }
          // Per-ticker `done` is not run-terminal; sequential tickers keep appending.
        }
      } catch {
        // Client abort or enqueue after close.
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      // Dropping SSE must not kill the detached Python child.
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
