export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any)?.id;

  try {
    const keys = await prisma.apiKey.findMany({ where: { userId } });
    return NextResponse.json(keys?.map((k: any) => ({
      provider: k?.provider,
      hasKey: !!(k?.apiKey),
      updatedAt: k?.updatedAt?.toISOString?.(),
    })) ?? []);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as any)?.id;

  try {
    const body = await req.json();
    const { provider, apiKey } = body ?? {};
    if (!provider || !apiKey) return NextResponse.json({ error: 'Provider and apiKey required' }, { status: 400 });

    await prisma.apiKey.upsert({
      where: { userId_provider: { userId, provider } },
      update: { apiKey },
      create: { userId, provider, apiKey },
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed' }, { status: 500 });
  }
}
