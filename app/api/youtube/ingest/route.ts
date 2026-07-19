export const dynamic = 'force-dynamic';
export const maxDuration = 300;

import fs from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runYoutube } from '@/lib/python-runner';
import { youtubeApiConfigured } from '@/lib/youtube/channels';
import { upsertFromIngestResult, upsertYoutubeSummary } from '@/lib/youtube/db';
import { parseYoutubeVideoId } from '@/lib/youtube/url';
import { prisma } from '@/lib/prisma';

/**
 * Manual failsafe ingest:
 * - { url | videoId } → fetch + auto transcript + summarize
 * - { url | videoId, transcript } → summarize with pasted transcript
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const rawRef = String(body?.url || body?.videoId || '').trim();
    const videoId = parseYoutubeVideoId(rawRef);
    const transcript = typeof body?.transcript === 'string' ? body.transcript.trim() : '';
    const titleOverride = typeof body?.title === 'string' ? body.title.trim() : '';
    const channelOverride = typeof body?.channel === 'string' ? body.channel.trim() : '';

    if (!videoId) {
      return NextResponse.json(
        { error: 'Provide a valid YouTube URL or 11-character video id' },
        { status: 400 },
      );
    }

    // Prefer existing DB metadata for re-summarize
    const existing = await prisma.youtubeVideoSummary.findUnique({ where: { videoId } });
    const title = titleOverride || existing?.title || '';
    const channel = channelOverride || existing?.channelHandle || '';

    let ingestResult: any;

    if (transcript) {
      if (transcript.length < 40) {
        return NextResponse.json(
          { error: 'Transcript is too short — paste at least a few sentences' },
          { status: 400 },
        );
      }

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-transcript-'));
      const transcriptPath = path.join(tmpDir, `${videoId}.txt`);
      try {
        fs.writeFileSync(transcriptPath, transcript, 'utf-8');
        if (title && channel) {
          ingestResult = await runYoutube(['summarize', videoId, transcriptPath, title, channel]);
        } else if (title) {
          ingestResult = await runYoutube(['summarize', videoId, transcriptPath, title]);
        } else if (channel) {
          ingestResult = await runYoutube(['summarize', videoId, transcriptPath, '', channel]);
        } else {
          ingestResult = await runYoutube(['summarize', videoId, transcriptPath]);
        }
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          /* ignore cleanup errors */
        }
      }
    } else {
      if (!youtubeApiConfigured()) {
        return NextResponse.json(
          {
            error:
              'YOUTUBE_API_KEY not configured. Paste a transcript to summarize without the API, or add the key to .env.',
          },
          { status: 503 },
        );
      }
      ingestResult = await runYoutube(['video', videoId]);
    }

    // Preserve existing publish date / channel when Python returns blanks
    if (ingestResult && typeof ingestResult === 'object') {
      if (!ingestResult.published_at && existing?.publishedAt) {
        ingestResult.published_at = existing.publishedAt.toISOString();
      }
      if (!ingestResult.channel && existing?.channelHandle) {
        ingestResult.channel = existing.channelHandle;
      }
      if (!ingestResult.title && existing?.title) {
        ingestResult.title = existing.title;
      }
      if (!ingestResult.channel_id && existing?.channelId) {
        ingestResult.channel_id = existing.channelId;
      }
    }

    console.log('[youtube/ingest]', {
      videoId,
      mode: transcript ? 'manual_transcript' : 'auto',
      thesis: ingestResult?.summary?.key_thesis?.slice?.(0, 120),
      confidence: ingestResult?.summary?.confidence,
      error: ingestResult?.error,
    });

    if (ingestResult?.error && !ingestResult?.summary && !ingestResult?.video_id) {
      return NextResponse.json({ error: ingestResult.error, result: ingestResult }, { status: 502 });
    }

    // Prefer single-record upsert for clarity
    let saved = null;
    if (ingestResult?.video_id) {
      saved = await upsertYoutubeSummary(ingestResult);
    }
    if (!saved) {
      const { upserted } = await upsertFromIngestResult(ingestResult);
      if (!upserted) {
        return NextResponse.json(
          {
            error: ingestResult?.error || 'Ingest produced no savable summary',
            result: ingestResult,
          },
          { status: 502 },
        );
      }
    }

    const item =
      saved ||
      (await prisma.youtubeVideoSummary.findUnique({ where: { videoId } }).then((row) =>
        row
          ? {
              id: row.id,
              videoId: row.videoId,
              title: row.title,
              channelHandle: row.channelHandle,
              channelId: row.channelId,
              publishedAt: row.publishedAt.toISOString(),
              url: row.url,
              transcriptLength: row.transcriptLength,
              summary: row.summary,
              rawTranscriptSnippet: row.rawTranscriptSnippet,
              stockMentions: row.stockMentions,
              processedAt: row.processedAt.toISOString(),
              updatedAt: row.updatedAt.toISOString(),
            }
          : null,
      ));

    return NextResponse.json({
      ok: true,
      mode: transcript ? 'manual_transcript' : 'auto',
      item,
      result: ingestResult,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Ingest failed' }, { status: 500 });
  }
}
