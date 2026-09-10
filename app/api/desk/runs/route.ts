export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireDeskAccess } from '@/lib/desk/access';
import { consumeDeskRateLimit } from '@/lib/desk/rate-limit';
import { redactDeskSecrets } from '@/lib/desk/redact';
import { reapOrphanDeskRuns, startDeskRun } from '@/lib/desk/runner';
import { DESK_ANALYSTS, DESK_ASSET_TYPES, DESK_DEPTHS } from '@/lib/desk/types';
import { prisma } from '@/lib/prisma';

const createDeskRunSchema = z
  .object({
    tickers: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(10)
          .transform((ticker) => ticker.toUpperCase()),
      )
      .min(1, 'At least one ticker is required')
      .max(3, 'Maximum 3 tickers per run'),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'asOf must be YYYY-MM-DD'),
    depth: z.enum(DESK_DEPTHS),
    analysts: z.array(z.enum(DESK_ANALYSTS)).min(1, 'At least one analyst is required'),
    assetType: z.enum(DESK_ASSET_TYPES),
    checkpoint: z.boolean(),
  })
  .refine((input) => input.assetType !== 'crypto' || !input.analysts.includes('fundamentals'), {
    message: 'Crypto runs cannot include the fundamentals analyst',
    path: ['analysts'],
  });

export async function POST(req: NextRequest) {
  const auth = await requireDeskAccess();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  const parsed = createDeskRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }

  const input = parsed.data;

  await reapOrphanDeskRuns(auth.userId);

  const rateLimit = consumeDeskRateLimit(auth.userId, input.depth);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: `Trading Desk rate limit reached (bucket=${rateLimit.bucket}, remaining=${rateLimit.remaining})`,
        bucket: rateLimit.bucket,
        remaining: rateLimit.remaining,
        resetAt: new Date(rateLimit.resetAt).toISOString(),
        retryAfterSec: rateLimit.retryAfterSec,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSec) },
      },
    );
  }

  const run = await prisma.deskRun.create({
    data: {
      userId: auth.userId,
      tickers: input.tickers,
      asOf: input.asOf,
      depth: input.depth,
      analysts: input.analysts,
      assetType: input.assetType,
      checkpoint: input.checkpoint,
      status: 'queued',
      params: input,
    },
  });

  try {
    await startDeskRun({
      id: run.id,
      userId: auth.userId,
      tickers: input.tickers,
      asOf: input.asOf,
      depth: input.depth,
      analysts: input.analysts,
      assetType: input.assetType,
      checkpoint: input.checkpoint,
      openRouterKey: auth.key.key,
    });
  } catch (error) {
    const message = redactDeskSecrets(
      error instanceof Error ? error.message : 'Desk runner failed to start',
      [auth.key.key],
    );
    await prisma.deskRun.update({
      where: { id: run.id },
      data: { status: 'failed', error: message, finishedAt: new Date() },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const started = await prisma.deskRun.findUnique({ where: { id: run.id } });
  return NextResponse.json(started ?? run, { status: 201 });
}

export async function GET() {
  const auth = await requireDeskAccess();
  if (auth instanceof NextResponse) return auth;

  await reapOrphanDeskRuns(auth.userId);

  const runs = await prisma.deskRun.findMany({
    where: { userId: auth.userId },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: {
      id: true,
      tickers: true,
      activeTicker: true,
      asOf: true,
      depth: true,
      analysts: true,
      assetType: true,
      checkpoint: true,
      status: true,
      signal: true,
      createdAt: true,
      updatedAt: true,
      finishedAt: true,
    },
  });

  return NextResponse.json(runs);
}
