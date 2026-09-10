export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireDeskAccess } from '@/lib/desk/access';
import { cancelDeskRun, reapOrphanDeskRuns } from '@/lib/desk/runner';
import { prisma } from '@/lib/prisma';

interface RouteContext {
  params: { id: string };
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const auth = await requireDeskAccess();
  if (auth instanceof NextResponse) return auth;

  await reapOrphanDeskRuns(auth.userId);

  const run = await prisma.deskRun.findFirst({
    where: { id: params.id, userId: auth.userId },
  });

  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  return NextResponse.json(run);
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const auth = await requireDeskAccess();
  if (auth instanceof NextResponse) return auth;

  const run = await cancelDeskRun(params.id, auth.userId);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  return NextResponse.json(run);
}
