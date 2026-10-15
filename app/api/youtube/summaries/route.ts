export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { serverError } from '@/lib/http/errors';
import { listYoutubeSummaries } from '@/lib/youtube/db';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;

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
  } catch (error) {
    return serverError('youtube/summaries', error, 'Could not load video summaries');
  }
}
