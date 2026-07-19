export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paperError, requirePaperUser } from '@/lib/paper/http';

function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET() {
  const userId = await requirePaperUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const trades = await prisma.paperTrade.findMany({
      where: { userId },
      include: { fills: { orderBy: [{ filledAt: 'asc' }, { createdAt: 'asc' }] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const headers = [
      'id',
      'symbol',
      'side',
      'status',
      'thesis',
      'invalidation',
      'plannedEntry',
      'plannedStop',
      'plannedTarget',
      'plannedRisk',
      'plannedRiskPct',
      'plannedShares',
      'setupTag',
      'strategyTag',
      'qty',
      'avgEntry',
      'avgExit',
      'openedAt',
      'closedAt',
      'stop',
      'target',
      'realizedPnl',
      'realizedR',
      'fees',
      'mfe',
      'mae',
      'exitEfficiency',
      'planFollowed',
      'emotionTags',
      'mistakeTags',
      'rating',
      'preNotes',
      'managementNotes',
      'postNotes',
      'fillsJson',
      'createdAt',
      'updatedAt',
    ];
    const rows = trades.map((trade) => [
      trade.id,
      trade.symbol,
      trade.side,
      trade.status,
      trade.thesis,
      trade.invalidation,
      trade.plannedEntry?.toFixed(),
      trade.plannedStop?.toFixed(),
      trade.plannedTarget?.toFixed(),
      trade.plannedRisk?.toFixed(),
      trade.plannedRiskPct?.toFixed(),
      trade.plannedShares?.toFixed(),
      trade.setupTag,
      trade.strategyTag,
      trade.qty.toFixed(),
      trade.avgEntry?.toFixed(),
      trade.avgExit?.toFixed(),
      trade.openedAt?.toISOString(),
      trade.closedAt?.toISOString(),
      trade.stop.toFixed(),
      trade.target?.toFixed(),
      trade.realizedPnl.toFixed(),
      trade.realizedR?.toFixed(),
      trade.fees.toFixed(),
      trade.mfe?.toFixed(),
      trade.mae?.toFixed(),
      trade.exitEfficiency?.toFixed(),
      trade.planFollowed,
      trade.emotionTags.join('|'),
      trade.mistakeTags.join('|'),
      trade.rating,
      trade.preNotes,
      trade.managementNotes,
      trade.postNotes,
      JSON.stringify(
        trade.fills.map((fill) => ({
          id: fill.id,
          side: fill.side,
          type: fill.type,
          qty: fill.qty.toFixed(),
          price: fill.price.toFixed(),
          fee: fill.fee.toFixed(),
          filledAt: fill.filledAt.toISOString(),
          note: fill.note,
        })),
      ),
      trade.createdAt.toISOString(),
      trade.updatedAt.toISOString(),
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    const date = new Date().toISOString().slice(0, 10);
    return new Response(`\uFEFF${csv}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="paper-trades-${date}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return paperError(error);
  }
}
