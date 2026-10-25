import { withMutationProtection } from '@/lib/security/mutation';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireInsightsAccess } from '@/lib/insights/access';
import { prisma } from '@/lib/prisma';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const auth = await requireInsightsAccess();
  if (auth instanceof NextResponse) return auth;

  const session = await prisma.insightSession.findFirst({
    where: { id: (await params).id, userId: auth.userId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  return NextResponse.json({
    id: session.id,
    title: session.title || 'New insight chat',
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    messages: session.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      metadata: message.metadata,
      createdAt: message.createdAt.toISOString(),
    })),
  });
}

async function DELETEHandler(_req: NextRequest, { params }: RouteContext) {
  const auth = await requireInsightsAccess();
  if (auth instanceof NextResponse) return auth;

  const session = await prisma.insightSession.findFirst({
    where: { id: (await params).id, userId: auth.userId },
    select: { id: true },
  });

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  await prisma.insightSession.delete({ where: { id: (await params).id } });
  return NextResponse.json({ success: true });
}

export const DELETE = withMutationProtection(DELETEHandler);
