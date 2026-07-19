export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireInsightsAccess } from '@/lib/insights/access';
import {
  INSIGHTS_MAX_IMAGE_BYTES,
  INSIGHTS_MAX_IMAGES_PER_MESSAGE,
} from '@/lib/insights/config';
import { resolveInsightsModel } from '@/lib/insights/models';
import { checkInsightRateLimit } from '@/lib/insights/rate-limit';
import { runInsightChat, type InsightStreamEvent } from '@/lib/insights/orchestrator';
import type { InsightImageAttachment } from '@/lib/insights/types';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const auth = await requireInsightsAccess();
  if (auth instanceof NextResponse) return auth;

  const userId = auth.userId;
  const resolvedKey = auth.key;

  const rateLimit = checkInsightRateLimit(userId);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'AI Insights rate limit reached', resetAt: new Date(rateLimit.resetAt).toISOString() },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const requestedSessionId = typeof body?.sessionId === 'string' ? body.sessionId : null;
  const modelId = resolveInsightsModel(typeof body?.modelId === 'string' ? body.modelId : null);
  const images = normalizeImages(body?.images);

  if (!message && images.length === 0) {
    return NextResponse.json({ error: 'Message or image required' }, { status: 400 });
  }

  const insightSession = await getOrCreateSession(userId, requestedSessionId, message || 'Image analysis');
  if (!insightSession) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const userContent = message || 'Please analyze the attached image(s).';
  const userMetadata = images.length > 0 ? { images } : undefined;

  await prisma.insightMessage.create({
    data: {
      sessionId: insightSession.id,
      role: 'user',
      content: userContent,
      metadata: userMetadata as any,
    },
  });

  const history = await prisma.insightMessage.findMany({
    where: { sessionId: insightSession.id },
    orderBy: { createdAt: 'asc' },
  });

  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const send = async (event: string, data: unknown) => {
    await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };

  const handleEvent = async (event: InsightStreamEvent) => {
    const { type, ...payload } = event as any;
    await send(type, payload);
  };

  void (async () => {
    try {
      await send('session', {
        id: insightSession.id,
        title: insightSession.title || titleFromMessage(userContent),
        keySource: resolvedKey.source,
        remaining: rateLimit.remaining,
        modelId,
      });

      const result = await runInsightChat({
        apiKey: resolvedKey.key,
        userId,
        sessionId: insightSession.id,
        modelId,
        messages: history.map((item) => ({
          role: item.role === 'assistant' ? 'assistant' : 'user',
          content: item.content,
          metadata: item.metadata as any,
        })),
        onEvent: handleEvent,
      });

      await prisma.insightMessage.create({
        data: {
          sessionId: insightSession.id,
          role: 'assistant',
          content: result.content,
          metadata: result.metadata as any,
        },
      });

      await prisma.insightSession.update({
        where: { id: insightSession.id },
        data: { title: insightSession.title || titleFromMessage(userContent) },
      });

      await send('done', {
        sessionId: insightSession.id,
        modelUsed: result.metadata.modelUsed,
      });
    } catch (error: any) {
      await send('error', { message: error?.message || 'AI Insights failed' });
    } finally {
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

function normalizeImages(raw: unknown): InsightImageAttachment[] {
  if (!Array.isArray(raw)) return [];

  const images: InsightImageAttachment[] = [];
  for (const item of raw.slice(0, INSIGHTS_MAX_IMAGES_PER_MESSAGE)) {
    if (!item || typeof item !== 'object') continue;
    const url = typeof (item as any).url === 'string' ? (item as any).url : '';
    if (!url.startsWith('data:image/')) continue;

    const approxBytes = Math.floor((url.length * 3) / 4);
    if (approxBytes > INSIGHTS_MAX_IMAGE_BYTES) continue;

    images.push({
      url,
      mimeType: typeof (item as any).mimeType === 'string' ? (item as any).mimeType : undefined,
      name: typeof (item as any).name === 'string' ? (item as any).name : undefined,
    });
  }

  return images;
}

async function getOrCreateSession(userId: string, sessionId: string | null, firstMessage: string) {
  if (sessionId) {
    return prisma.insightSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true, title: true },
    });
  }

  return prisma.insightSession.create({
    data: { userId, title: titleFromMessage(firstMessage) },
    select: { id: true, title: true },
  });
}

function titleFromMessage(message: string) {
  const title = message.trim().split(/\s+/).slice(0, 8).join(' ');
  return title.length > 80 ? `${title.slice(0, 77)}...` : title || 'New insight chat';
}
