export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireDeskAccess } from '@/lib/desk/access';
import { deskInsightsDigest, parseDeskReport, parseDeskSignalText, resolveDeskRating } from '@/lib/desk/report';
import type { DeskSignal } from '@/lib/desk/types';
import { serverError } from '@/lib/http/errors';
import { prisma } from '@/lib/prisma';

interface RouteContext {
  params: { id: string };
}

function asSignal(value: string | null): DeskSignal | null {
  return parseDeskSignalText(value);
}

export async function POST(_req: Request, { params }: RouteContext) {
  const auth = await requireDeskAccess();
  if (auth instanceof NextResponse) return auth;

  const run = await prisma.deskRun.findFirst({
    where: { id: params.id, userId: auth.userId },
  });
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const status = run.status === 'completed' || run.status === 'review' ? run.status : null;
  if (!status) {
    return NextResponse.json({ error: 'Report is only available after the run finishes' }, { status: 409 });
  }

  const ticker = (run.tickers[0] ?? 'TICKER').toUpperCase();
  const report = parseDeskReport(run.finalState, ticker);
  const rating = resolveDeskRating(asSignal(run.signal), report, status);
  const digest = deskInsightsDigest(report, rating);
  const title = `Desk · ${report.ticker || ticker}${rating ? ` · ${rating}` : ''}`.slice(0, 80);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const session = await tx.insightSession.create({
        data: { userId: auth.userId, title },
        select: { id: true, title: true },
      });
      await tx.insightMessage.create({
        data: { sessionId: session.id, role: 'user', content: digest },
      });
      return session;
    });

    return NextResponse.json({ sessionId: created.id, title: created.title ?? title });
  } catch (error) {
    return serverError('desk/insights', error, 'Could not send this report to Insights');
  }
}
