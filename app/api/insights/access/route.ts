export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  isInsightsAdmin,
  resolveOpenRouterKey,
  syncAdminRole,
} from '@/lib/insights/access';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as { id?: string })?.id;
  const email = session.user.email?.trim().toLowerCase();
  if (!userId || !email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = await syncAdminRole(userId, email);
  const isAdmin = isInsightsAdmin(email, role);
  const resolved = await resolveOpenRouterKey(userId, email, role);

  const payload: Record<string, unknown> = {
    hasAccess: !!resolved,
    source: resolved?.source ?? null,
    isAdmin,
    role: role ?? 'user',
    adminKeyConfigured: isAdmin && !!process.env.OPENROUTER_API_KEY?.trim(),
  };

  if (isAdmin) {
    const users = await prisma.user.findMany({
      select: {
        email: true,
        name: true,
        role: true,
        createdAt: true,
        _count: { select: { insightSessions: true, apiKeys: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    payload.userCount = users.length;
    payload.users = users.map((user) => ({
      email: user.email,
      name: user.name,
      role: user.role,
      isInsightsAdmin: isInsightsAdmin(user.email, user.role),
      insightSessions: user._count.insightSessions,
      apiKeyCount: user._count.apiKeys,
      createdAt: user.createdAt.toISOString(),
    }));
  }

  return NextResponse.json(payload);
}
