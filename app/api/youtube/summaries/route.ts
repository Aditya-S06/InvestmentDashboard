export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listYoutubeSummaries } from '@/lib/youtube/db';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sp = req.nextUrl.searchParams;
    const channel = sp.get('channel') || undefined;
    const ticker = sp.get('ticker') || undefined;
    const sinceDays = sp.get('since_days') ? Number(sp.get('since_days')) : undefined;
    const limit = sp.get('limit') ? Number(sp.get('limit')) : 20;

    const items = await listYoutubeSummaries({
      channel,
      ticker,
      sinceDays: Number.isFinite(sinceDays) ? sinceDays : undefined,
      limit: Number.isFinite(limit) ? limit : 20,
    });

    return NextResponse.json({ items, count: items.length });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to list summaries' }, { status: 500 });
  }
}
