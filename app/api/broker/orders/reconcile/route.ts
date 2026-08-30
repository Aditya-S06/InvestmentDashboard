import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireBrokerAdmin } from '@/lib/webull/require-admin';
import { listHistoryFromBroker, tradingErrorResponse } from '@/lib/webull/orders';
import { getWebullEnvironment } from '@/lib/webull/config';
import { syncLiveFill } from '@/lib/webull/journal-sync';
import { writeBrokerAudit } from '@/lib/webull/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await requireBrokerAdmin();
  if ('error' in auth) return auth.error;
  try {
    const accountId = req.nextUrl.searchParams.get('accountId')?.trim();
    if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 });
    const history = await listHistoryFromBroker(accountId);
    const rows = Array.isArray(history.orders)
      ? history.orders
      : history.orders?.data || history.orders?.list || [];
    let imported = 0;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const clientOrderId = String(row.client_order_id || row.clientOrderId || '').trim();
      if (!clientOrderId) continue;
      const existing = await prisma.brokerOrder.findUnique({ where: { clientOrderId } });
      if (existing) continue;
      const qty = Number(row.quantity || row.qty || 0) || 0;
      const filled = Number(row.filled_qty || row.filledQty || 0) || 0;
      const created = await prisma.brokerOrder.create({
        data: {
          userId: auth.userId,
          accountId,
          environment: getWebullEnvironment(),
          clientOrderId,
          webullOrderId: row.order_id ? String(row.order_id) : null,
          symbol: String(row.symbol || '').toUpperCase(),
          side: String(row.side || 'BUY').toUpperCase(),
          orderType: String(row.order_type || row.orderType || 'LIMIT'),
          tif: String(row.time_in_force || row.tif || 'DAY'),
          session: String(row.support_trading_session || 'CORE'),
          qty: new Prisma.Decimal(qty || filled || 0),
          status: String(row.order_status || row.status || 'SUBMITTED').toUpperCase(),
          filledQty: new Prisma.Decimal(filled),
          avgFillPrice: row.avg_filled_price || row.filled_price ? new Prisma.Decimal(Number(row.avg_filled_price || row.filled_price)) : null,
          source: 'webull_import',
          payloadHash: 'import',
          lastWebullDetail: row as object,
        },
      });
      imported += 1;
      if (created.environment === 'prod' && filled > 0) {
        await syncLiveFill({
          ...created,
          thesis: created.thesis,
          invalidation: created.invalidation,
          preNotes: created.preNotes ?? 'Imported from Webull — add thesis',
        });
      }
    }
    await writeBrokerAudit({
      userId: auth.userId,
      action: 'sync',
      payload: { accountId, imported },
    });
    return NextResponse.json({ imported, rawCount: rows.length });
  } catch (error) {
    const mapped = tradingErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
