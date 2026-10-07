export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireDeskAccess } from '@/lib/desk/access';
import { listDeskCheckpointTickers } from '@/lib/desk/config';
import { isDeskTicker, type DeskCheckpointListing } from '@/lib/desk/types';
import { DeskCheckpointConflict, validateDeskArtifactPaths, withDeskCheckpointControl } from '@/lib/desk/runner';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const auth = await requireDeskAccess();
  if (auth instanceof NextResponse) return auth;
  try {
    validateDeskArtifactPaths(auth.userId);
    const requested = req.nextUrl.searchParams.get('tickers');
    const tickers = requested ? [...new Set(requested.split(',').map(t => t.trim().toUpperCase()))] : listDeskCheckpointTickers(auth.userId);
    if (tickers.length > 100 || tickers.some(t => !isDeskTicker(t))) return NextResponse.json({ error: 'Invalid tickers' }, { status: 400 });
    validateDeskArtifactPaths(auth.userId, undefined, tickers);
    const checkpoints = await withDeskCheckpointControl(auth.userId, async control => {
      const rows = await control<DeskCheckpointListing[]>({ command: 'list', tickers });
      const active = await prisma.deskRun.findMany({ where: { userId: auth.userId, status: { in: ['queued', 'running'] } }, select: { tickers: true } });
      for (const row of rows) {
        if (active.some(run => run.tickers.includes(row.ticker))) {
          row.checkpoints = []; row.reason = 'Ticker is queued/running; refresh after it stops.';
        }
      }
      return rows;
    });
    return NextResponse.json({ checkpoints, tickers: checkpoints.filter(c => c.checkpoints.length).map(c => c.ticker) });
  } catch {
    return NextResponse.json({ error: 'Checkpoint inspection unavailable or busy; retry.' }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireDeskAccess();
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => null);
  const ticker = typeof body?.ticker === 'string' ? body.ticker.trim().toUpperCase() : '';
  if (!isDeskTicker(ticker)) return NextResponse.json({ error: 'Invalid ticker' }, { status: 400 });
  try {
    validateDeskArtifactPaths(auth.userId, undefined, [ticker]);
    const result = await withDeskCheckpointControl(auth.userId, async control => {
      const active = await prisma.deskRun.findFirst({ where: { userId: auth.userId, status: { in: ['queued', 'running'] }, tickers: { has: ticker } }, select: { id: true } });
      if (active) throw new DeskCheckpointConflict('Cannot clear a queued/running ticker. Wait for the job to stop.');
      return control({ command: 'clear', ticker });
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof DeskCheckpointConflict ? error.message : 'Checkpoint clear unavailable; retry.' }, { status: error instanceof DeskCheckpointConflict ? 409 : 503 });
  }
}
