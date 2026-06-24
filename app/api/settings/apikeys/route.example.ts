/**
 * Copy to route.ts — per-user API key storage (BYOK).
 * route.ts is gitignored and never committed.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isInsightsAdmin, syncAdminRole } from '@/lib/insights/access';
import { prisma } from '@/lib/prisma';

const ALLOWED_PROVIDERS = new Set(['alpha_vantage', 'polygon', 'openrouter']);

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string })?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = await syncAdminRole(userId, session.user.email);
  const admin = isInsightsAdmin(session.user.email, role);
  const keys = await prisma.apiKey.findMany({ where: { userId } });

  return NextResponse.json(
    keys
      ?.filter((k) => !admin || k.provider !== 'openrouter')
      .map((k) => ({
        provider: k.provider,
        hasKey: !!k.apiKey,
        updatedAt: k.updatedAt.toISOString(),
      })) ?? [],
  );
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string })?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { provider, apiKey } = body ?? {};
  if (!provider || !apiKey) return NextResponse.json({ error: 'Provider and apiKey required' }, { status: 400 });
  if (!ALLOWED_PROVIDERS.has(provider)) return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });

  const role = await syncAdminRole(userId, session.user.email);
  const admin = isInsightsAdmin(session.user.email, role);

  if (provider === 'openrouter' && admin) {
    return NextResponse.json(
      { error: 'Admin account uses the server OpenRouter key in .env (OPENROUTER_API_KEY).' },
      { status: 403 },
    );
  }

  await prisma.apiKey.upsert({
    where: { userId_provider: { userId, provider } },
    update: { apiKey },
    create: { userId, provider, apiKey },
  });
  return NextResponse.json({ success: true });
}
