import 'server-only';

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export interface YoutubeSummaryPayload {
  video_id: string;
  title?: string;
  published_at?: string;
  url?: string;
  channel?: string;
  channel_id?: string;
  transcript_length?: number;
  summary?: Record<string, unknown> | null;
  raw_transcript_snippet?: string | null;
  skipped?: boolean;
  error?: string;
}

export interface ListYoutubeSummariesParams {
  channel?: string;
  ticker?: string;
  sinceDays?: number;
  limit?: number;
}

function normalizeHandle(channel: string): string {
  const s = channel.trim();
  if (!s) return s;
  if (s.startsWith('UC')) return s;
  return s.startsWith('@') ? s : `@${s}`;
}

function parsePublishedAt(value?: string): Date {
  if (!value) return new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export function serializeYoutubeSummary(row: {
  id: string;
  videoId: string;
  title: string;
  channelHandle: string;
  channelId: string | null;
  publishedAt: Date;
  url: string;
  transcriptLength: number;
  summary: Prisma.JsonValue;
  rawTranscriptSnippet: string | null;
  stockMentions: string[];
  processedAt: Date;
  updatedAt: Date;
}) {
  return {
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
  };
}

export async function listYoutubeSummaries(params: ListYoutubeSummariesParams = {}) {
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const where: Prisma.YoutubeVideoSummaryWhereInput = {};

  if (params.channel) {
    const handle = normalizeHandle(params.channel);
    where.OR = [
      { channelHandle: { equals: handle, mode: 'insensitive' } },
      { channelHandle: { equals: params.channel, mode: 'insensitive' } },
      { channelId: params.channel },
    ];
  }

  if (params.ticker) {
    where.stockMentions = { has: params.ticker.trim().toUpperCase() };
  }

  if (params.sinceDays && params.sinceDays > 0) {
    const since = new Date();
    since.setDate(since.getDate() - params.sinceDays);
    where.publishedAt = { gte: since };
  }

  const rows = await prisma.youtubeVideoSummary.findMany({
    where,
    orderBy: { publishedAt: 'desc' },
    take: limit,
  });

  return rows.map(serializeYoutubeSummary);
}

export async function upsertYoutubeSummary(payload: YoutubeSummaryPayload) {
  if (!payload.video_id || payload.skipped) {
    return null;
  }
  // Soft failures may still include a usable fallback summary — persist when present
  if (payload.error && !payload.summary) {
    return null;
  }

  const summary = (payload.summary ?? {}) as Prisma.InputJsonValue;
  const stockMentions = Array.isArray((payload.summary as any)?.stock_mentions)
    ? ((payload.summary as any).stock_mentions as string[])
        .map((s) => String(s).trim().toUpperCase())
        .filter(Boolean)
    : [];

  const channelHandle = payload.channel?.trim()
    ? normalizeHandle(payload.channel)
    : 'unknown';

  const row = await prisma.youtubeVideoSummary.upsert({
    where: { videoId: payload.video_id },
    create: {
      videoId: payload.video_id,
      title: payload.title || payload.video_id,
      channelHandle,
      channelId: payload.channel_id || null,
      publishedAt: parsePublishedAt(payload.published_at),
      url: payload.url || `https://www.youtube.com/watch?v=${payload.video_id}`,
      transcriptLength: payload.transcript_length ?? 0,
      summary,
      rawTranscriptSnippet: payload.raw_transcript_snippet ?? null,
      stockMentions,
    },
    update: {
      title: payload.title || payload.video_id,
      channelHandle,
      channelId: payload.channel_id || null,
      publishedAt: parsePublishedAt(payload.published_at),
      url: payload.url || `https://www.youtube.com/watch?v=${payload.video_id}`,
      transcriptLength: payload.transcript_length ?? 0,
      summary,
      rawTranscriptSnippet: payload.raw_transcript_snippet ?? null,
      stockMentions,
      processedAt: new Date(),
    },
  });

  return serializeYoutubeSummary(row);
}

/** Persist all non-skipped videos from a channel or poll result. */
export async function upsertFromIngestResult(result: any): Promise<{ upserted: number; skipped: number }> {
  let upserted = 0;
  let skipped = 0;

  const videosFromChannel = (channelResult: any) => {
    const videos = Array.isArray(channelResult?.videos) ? channelResult.videos : [];
    return videos;
  };

  let allVideos: YoutubeSummaryPayload[] = [];

  if (Array.isArray(result?.channels)) {
    for (const ch of result.channels) {
      allVideos.push(...videosFromChannel(ch));
    }
  } else if (Array.isArray(result?.videos)) {
    allVideos = videosFromChannel(result);
  } else if (result?.video_id) {
    allVideos = [result];
  }

  for (const video of allVideos) {
    if (video.skipped) {
      skipped += 1;
      continue;
    }
    if (video.error && !video.summary) {
      skipped += 1;
      continue;
    }
    const saved = await upsertYoutubeSummary(video);
    if (saved) upserted += 1;
    else skipped += 1;
  }

  return { upserted, skipped };
}
