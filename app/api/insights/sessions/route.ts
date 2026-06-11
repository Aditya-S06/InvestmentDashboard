export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireInsightsAccess } from '@/lib/insights/access';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const auth = await requireInsightsAccess();
  if (auth instanceof NextResponse) return auth;

  const sessions = await prisma.insightSession.findMany({
    where: { userId: auth.userId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });

  return NextResponse.json(
    sessions.map((session) => ({
      id: session.id,
      title: session.title || 'New insight chat',
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    })),
  );
}

export async function POST(req: NextRequest) {
  const auth = await requireInsightsAccess();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 80) : null;

  const session = await prisma.insightSession.create({
    data: { userId: auth.userId, title: title || 'New insight chat' },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });

  return NextResponse.json({
    id: session.id,
    title: session.title || 'New insight chat',
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  });
}
