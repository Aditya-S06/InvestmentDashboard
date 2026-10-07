export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { requireDeskAccess } from '@/lib/desk/access';
import { consumeDeskRateLimit } from '@/lib/desk/rate-limit';
import { redactDeskSecrets } from '@/lib/desk/redact';
import { DeskCheckpointConflict, withDeskCheckpointControl, finishDeskRun, reapOrphanDeskRuns, startDeskRun, validateDeskArtifactPaths } from '@/lib/desk/runner';
import { DESK_ANALYSTS, DESK_ASSET_TYPES, DESK_DEPTHS, isDeskDate, isDeskTicker } from '@/lib/desk/types';
import { emptyDeskResults, packDeskResults } from '@/lib/desk/report';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { DESK_RAW_ANALYST_MAX, DeskRequestError, readDeskLaunchJson } from '@/lib/desk/limits';

const createDeskRunSchema = z
  .object({
    tickers: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(10)
          .transform((ticker) => ticker.toUpperCase()).refine(isDeskTicker, 'Invalid ticker'),
      )
      .min(1, 'At least one ticker is required')
      .max(3, 'Maximum 3 tickers per run').transform(tickers => [...new Set(tickers)]),
    asOf: z.string().refine(isDeskDate, 'asOf must be a real YYYY-MM-DD date'),
    depth: z.enum(DESK_DEPTHS),
    analysts: z.array(z.enum(DESK_ANALYSTS)).min(1, 'At least one analyst is required')
      .max(DESK_RAW_ANALYST_MAX, `Maximum ${DESK_RAW_ANALYST_MAX} raw analyst selections`)
      .transform(values => DESK_ANALYSTS.filter(value => values.includes(value))),
    assetType: z.enum(DESK_ASSET_TYPES),
    checkpoint: z.boolean(),
    resume: z.object({ ticker: z.string().refine(isDeskTicker), threadId: z.string().regex(/^[a-f0-9]{16}$/), checkpointId: z.string().min(1).max(128) }).optional(),
  })
  .refine((input) => input.assetType !== 'crypto' || !input.analysts.includes('fundamentals'), {
    message: 'Crypto runs cannot include the fundamentals analyst',
    path: ['analysts'],
  });

export async function POST(req: NextRequest) {
  const auth = await requireDeskAccess();
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try { body = await readDeskLaunchJson(req); } catch (error) {
    if (error instanceof DeskRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const parsed = createDeskRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }

  const input = parsed.data;
  try { validateDeskArtifactPaths(auth.userId, undefined, input.tickers); } catch {
    return NextResponse.json({ error: 'Invalid Desk artifact path' }, { status: 400 });
  }

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

  try {
    return await withDeskCheckpointControl(auth.userId, async control => {
      if (input.resume) {
        if (!input.checkpoint || input.tickers.length !== 1 || input.tickers[0] !== input.resume.ticker) {
          return NextResponse.json({ error: 'Resume requires the saved single ticker and checkpoint enabled' }, { status: 400 });
        }
        await control({ command: 'restore', reference: input.resume, settings: { ...input, ticker: input.tickers[0] } });
      }
      const active = await prisma.deskRun.findFirst({ where: {
        userId: auth.userId, status: { in: ['queued', 'running'] }, tickers: { hasSome: input.tickers },
      }, select: { id: true } });
      if (active) throw new DeskCheckpointConflict('Ticker is already queued/running; retry after it stops.');
      const runId = randomUUID().replace(/-/g, '');
      await control({ command: 'reserve', tickers: input.tickers, runId });
      const run = await prisma.deskRun.create({
        data: {
          id: runId,
          userId: auth.userId,
          tickers: input.tickers,
          asOf: input.asOf,
          depth: input.depth,
          analysts: input.analysts,
          assetType: input.assetType,
          checkpoint: input.checkpoint,
          status: 'queued',
          params: input,
          finalState: packDeskResults(emptyDeskResults(input.tickers)) as Prisma.InputJsonValue,
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
          resume: input.resume,
        });
      } catch (error) {
        const message = redactDeskSecrets(
          error instanceof Error ? error.message : 'Desk runner failed to start',
          [auth.key.key],
        );
        await finishDeskRun(run.id, auth.userId, 'failed', message);
        return NextResponse.json({ error: message }, { status: 500 });
      }

      const started = await prisma.deskRun.findUnique({ where: { id: run.id } });
      return NextResponse.json(started ?? run, { status: 201 });
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof DeskCheckpointConflict ? error.message : 'Desk launch coordination failed; retry.' }, { status: error instanceof DeskCheckpointConflict ? error.status : 503 });
  }
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
