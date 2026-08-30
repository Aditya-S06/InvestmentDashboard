export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { requireInsightsAccess } from '@/lib/insights/access';
import { resolveInsightsModel } from '@/lib/insights/models';
import { checkInsightRateLimit } from '@/lib/insights/rate-limit';
import { runInsightChat } from '@/lib/insights/orchestrator';
import { serverError } from '@/lib/http/errors';
import { prisma } from '@/lib/prisma';

/** Phrasing matters: `userRequestsWatchlist` unlocks the watchlist + macro context. */
const BRIEF_PROMPT = [
  'Daily brief: go through my watchlist against the current macro snapshot.',
  'For each name give the trend, the level that matters today, and what would invalidate the setup.',
  'Finish with the two or three names that deserve attention first and why.',
].join(' ');

export async function POST() {
  const auth = await requireInsightsAccess();
  if (auth instanceof NextResponse) return auth;
  if (!auth.isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const rateLimit = checkInsightRateLimit(auth.userId);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'AI Insights rate limit reached', resetAt: new Date(rateLimit.resetAt).toISOString() },
      { status: 429 },
    );
  }

  const title = `Daily brief — ${new Date().toISOString().slice(0, 10)}`;

  try {
    const session = await prisma.insightSession.create({
      data: { userId: auth.userId, title },
      select: { id: true },
    });
    await prisma.insightMessage.create({
      data: { sessionId: session.id, role: 'user', content: BRIEF_PROMPT },
    });

    const result = await runInsightChat({
      apiKey: auth.key.key,
      userId: auth.userId,
      sessionId: session.id,
      modelId: resolveInsightsModel(null),
      isAdmin: true,
      messages: [{ role: 'user', content: BRIEF_PROMPT }],
    });

    await prisma.insightMessage.create({
      data: {
        sessionId: session.id,
        role: 'assistant',
        content: result.content,
        metadata: result.metadata as any,
      },
    });

    return NextResponse.json({ sessionId: session.id, title });
  } catch (error) {
    return serverError('insights/brief', error, 'Daily brief failed. Check the server logs and retry.');
  }
}
