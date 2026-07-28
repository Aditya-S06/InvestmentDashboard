export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  journalError,
  journalJson,
  optionalString,
  readJsonObject,
  requiredDate,
  requireJournalUser,
} from '@/lib/journal/http';

export async function GET() {
  const userId = await requireJournalUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const reviews = await prisma.personalReview.findMany({
      where: { userId },
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
    return journalJson({
      items: reviews.map((review) => ({
        ...review,
        periodType: review.reviewType,
      })),
    });
  } catch (error) {
    return journalError(error);
  }
}

export async function POST(request: Request) {
  const userId = await requireJournalUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const body = await readJsonObject(request);
    const reviewType = String(body.reviewType ?? body.periodType ?? 'DAY').toUpperCase();
    if (reviewType !== 'DAY' && reviewType !== 'WEEK') throw new Error('reviewType must be DAY or WEEK');
    const periodStart = requiredDate(body.periodStart, 'periodStart');
    periodStart.setUTCHours(0, 0, 0, 0);

    const closedInPeriod = await prisma.personalTrade.findMany({
      where: {
        userId,
        status: 'CLOSED',
        closedAt: {
          gte: periodStart,
          lt: new Date(
            periodStart.getTime() + (reviewType === 'WEEK' ? 7 : 1) * 24 * 60 * 60 * 1000,
          ),
        },
      },
    });
    const netPnl = closedInPeriod.reduce((sum, trade) => sum + Number(trade.realizedPnl ?? 0), 0);

    const review = await prisma.personalReview.upsert({
      where: {
        userId_reviewType_periodStart: {
          userId,
          reviewType,
          periodStart,
        },
      },
      create: {
        userId,
        reviewType,
        periodStart,
        grade: body.grade == null || body.grade === '' ? null : Number(body.grade),
        whatWentWell: optionalString(body.whatWentWell, 'whatWentWell'),
        whatToImprove: optionalString(body.whatToImprove, 'whatToImprove'),
        focusNext: optionalString(body.focusNext, 'focusNext'),
        netPnl,
        tradeCount: closedInPeriod.length,
      },
      update: {
        grade: body.grade == null || body.grade === '' ? null : Number(body.grade),
        whatWentWell: optionalString(body.whatWentWell, 'whatWentWell'),
        whatToImprove: optionalString(body.whatToImprove, 'whatToImprove'),
        focusNext: optionalString(body.focusNext, 'focusNext'),
        netPnl,
        tradeCount: closedInPeriod.length,
      },
    });

    return journalJson({ review: { ...review, periodType: review.reviewType } }, 201);
  } catch (error) {
    return journalError(error);
  }
}
