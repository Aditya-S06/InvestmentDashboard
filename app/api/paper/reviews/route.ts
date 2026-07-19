export const dynamic = 'force-dynamic';

import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  optionalDate,
  optionalString,
  paperError,
  paperJson,
  readJsonObject,
  requirePaperUser,
} from '@/lib/paper/http';
import { getOrCreatePaperAccount } from '@/lib/paper/service';
import type { ReviewType } from '@/lib/paper/types';

const REVIEW_TYPES = new Set<ReviewType>(['DAY', 'WEEK']);

function reviewType(value: unknown): ReviewType {
  const type = String(value || '').toUpperCase() as ReviewType;
  if (!REVIEW_TYPES.has(type)) throw new Error('reviewType must be DAY or WEEK');
  return type;
}

function periodStart(value: unknown): Date {
  const date = optionalDate(value, 'periodStart');
  if (!date) throw new Error('periodStart is required');
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function metrics(userId: string, type: ReviewType, start: Date) {
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + (type === 'DAY' ? 1 : 7));
  const trades = await prisma.paperTrade.findMany({
    where: { userId, status: 'CLOSED', closedAt: { gte: start, lt: end } },
    select: { realizedPnl: true, planFollowed: true },
  });
  const followed = trades.filter((trade) => trade.planFollowed === true).length;
  const graded = trades.filter((trade) => trade.planFollowed != null).length;
  const ruleAdherencePct = graded ? new Prisma.Decimal(followed).div(graded).mul(100) : null;
  return {
    netPnl: trades.reduce((sum, trade) => sum.plus(trade.realizedPnl), new Prisma.Decimal(0)),
    tradeCount: trades.length,
    ruleAdherencePct,
    adherenceSnapshot: {
      followed,
      graded,
      percent: ruleAdherencePct?.toFixed(4) ?? null,
    } as Prisma.InputJsonValue,
  };
}

function reviewGrade(value: unknown): number | null {
  if (value == null || value === '') return null;
  const grade = Number(value);
  if (!Number.isInteger(grade) || grade < 1 || grade > 5) {
    throw new Error('grade must be an integer from 1 to 5');
  }
  return grade;
}

export async function GET(request: Request) {
  const userId = await requirePaperUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const url = new URL(request.url);
    const typeParam = url.searchParams.get('type');
    const type = typeParam ? reviewType(typeParam) : undefined;
    const from = optionalDate(url.searchParams.get('from'), 'from');
    const to = optionalDate(url.searchParams.get('to'), 'to');
    if (from && to && from > to) throw new Error('from cannot be after to');
    const items = await prisma.journalReview.findMany({
      where: {
        userId,
        ...(type ? { reviewType: type } : {}),
        periodStart: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
      },
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
    });
    return paperJson({ items });
  } catch (error) {
    return paperError(error);
  }
}

export async function POST(request: Request) {
  const userId = await requirePaperUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const body = await readJsonObject(request);
    const type = reviewType(body.reviewType);
    const start = periodStart(body.periodStart);
    const [account, snapshot] = await Promise.all([
      getOrCreatePaperAccount(userId),
      metrics(userId, type, start),
    ]);
    const grade = reviewGrade(body.grade);
    const reflections = optionalString(body.reflections, 'reflections') || null;
    const whatWentWell = optionalString(body.whatWentWell, 'whatWentWell') || null;
    const whatToImprove = optionalString(body.whatToImprove, 'whatToImprove') || null;
    const focusNext = optionalString(body.focusNext, 'focusNext') || null;
    const item = await prisma.journalReview.upsert({
      where: { userId_reviewType_periodStart: { userId, reviewType: type, periodStart: start } },
      create: {
        accountId: account.id,
        userId,
        reviewType: type,
        periodStart: start,
        grade,
        reflections,
        whatWentWell,
        whatToImprove,
        focusNext,
        ...snapshot,
      },
      update: { grade, reflections, whatWentWell, whatToImprove, focusNext, ...snapshot },
    });
    return paperJson(item, 201);
  } catch (error) {
    return paperError(error);
  }
}

export async function PATCH(request: Request) {
  const userId = await requirePaperUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const body = await readJsonObject(request);
    const id = optionalString(body.id, 'id', 64);
    if (!id) throw new Error('id is required');
    const current = await prisma.journalReview.findFirst({ where: { id, userId } });
    if (!current) return NextResponse.json({ error: 'Review not found' }, { status: 404 });

    const data: Prisma.JournalReviewUncheckedUpdateInput = {};
    if (body.grade !== undefined) data.grade = reviewGrade(body.grade);
    if (body.reflections !== undefined) {
      data.reflections = optionalString(body.reflections, 'reflections') || null;
    }
    if (body.whatWentWell !== undefined) {
      data.whatWentWell = optionalString(body.whatWentWell, 'whatWentWell') || null;
    }
    if (body.whatToImprove !== undefined) {
      data.whatToImprove = optionalString(body.whatToImprove, 'whatToImprove') || null;
    }
    if (body.focusNext !== undefined) {
      data.focusNext = optionalString(body.focusNext, 'focusNext') || null;
    }
    if (body.refreshSnapshot === true) {
      Object.assign(data, await metrics(userId, current.reviewType, current.periodStart));
    }
    await prisma.journalReview.updateMany({ where: { id, userId }, data });
    return paperJson(await prisma.journalReview.findFirst({ where: { id, userId } }));
  } catch (error) {
    return paperError(error);
  }
}
