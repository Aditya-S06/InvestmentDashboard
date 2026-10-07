export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireDeskAccess } from '@/lib/desk/access';
import { deskInsightsDigest, isAvailableDeskResult, reportForDeskResult, selectDeskResult } from '@/lib/desk/report';
import { finalizeDeskRun, hydrateDeskRun } from '@/lib/desk/runner';
import { redactDeskSecrets } from '@/lib/desk/redact';
import { serverError } from '@/lib/http/errors';
import { prisma } from '@/lib/prisma';

interface RouteContext {
  params: { id: string };
}

export async function POST(req: Request, { params }: RouteContext) {
  const auth = await requireDeskAccess();
  if (auth instanceof NextResponse) return auth;

  await finalizeDeskRun(params.id, auth.userId);
  const run = await prisma.deskRun.findFirst({
    where: { id: params.id, userId: auth.userId },
  });
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const selected = selectDeskResult(hydrateDeskRun(run), new URL(req.url).searchParams.get('ticker'));
  if (!selected) return NextResponse.json({ error: 'Ticker not found' }, { status: 404 });
  if (!isAvailableDeskResult(selected)) return NextResponse.json({ error: 'Ticker report is not available' }, { status: 409 });
  const { report, rating } = reportForDeskResult(selected, run.asOf);
  const digest = redactDeskSecrets(deskInsightsDigest(report, rating), [auth.key.key]);
  const title = `Desk · ${selected.ticker} · ${rating}`.slice(0, 80);

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
