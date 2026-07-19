export const dynamic = 'force-dynamic';
export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runYoutube } from '@/lib/python-runner';
import {
  readChannelsConfig,
  writeChannelsConfig,
  youtubeApiConfigured,
  channelsFilePath,
} from '@/lib/youtube/channels';
import { upsertFromIngestResult } from '@/lib/youtube/db';
import fs from 'fs';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!youtubeApiConfigured()) {
    return NextResponse.json(
      { error: 'YOUTUBE_API_KEY not configured. Add it to .env and restart the server.' },
      { status: 503 },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const channel = typeof body?.channel === 'string' ? body.channel.trim() : '';
    const all = Boolean(body?.all);
    const cfg = readChannelsConfig();
    const limit = Number(body?.limit) > 0 ? Number(body.limit) : cfg.default_limit;
    const sinceDays = Number(body?.since_days) > 0 ? Number(body.since_days) : cfg.since_days;

    // Ensure channels file exists on disk for Python poll
    const filePath = channelsFilePath();
    if (!fs.existsSync(filePath)) {
      writeChannelsConfig(cfg);
    }

    let ingestResult: any;

    if (channel) {
      ingestResult = await runYoutube(['channel', channel, String(limit), String(sinceDays)]);
    } else if (all || !channel) {
      ingestResult = await runYoutube(['poll', filePath]);
    } else {
      return NextResponse.json({ error: 'Provide channel or all=true' }, { status: 400 });
    }

    if (ingestResult?.error && !ingestResult?.videos && !ingestResult?.channels) {
      return NextResponse.json(
        { error: ingestResult.error, result: ingestResult },
        { status: 502 },
      );
    }

    const { upserted, skipped } = await upsertFromIngestResult(ingestResult);

    return NextResponse.json({
      ok: true,
      upserted,
      skipped,
      result: ingestResult,
      polledAt: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Poll failed' }, { status: 500 });
  }
}
