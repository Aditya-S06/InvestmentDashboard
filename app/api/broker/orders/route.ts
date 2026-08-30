import { NextRequest, NextResponse } from 'next/server';
import { requireBrokerAdmin } from '@/lib/webull/require-admin';
import { listOpenFromBroker, listOrders, asOrderRows, tradingErrorResponse } from '@/lib/webull/orders';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireBrokerAdmin();
  if ('error' in auth) return auth.error;
  try {
    const accountId = req.nextUrl.searchParams.get('accountId')?.trim() || undefined;
    const orders = await listOrders(auth.userId, accountId);
    let open: unknown[] = [];
    if (accountId) {
      try {
        const raw = await listOpenFromBroker(accountId);
        open = asOrderRows(raw.orders ?? raw);
      } catch {
        open = [];
      }
    }
    return NextResponse.json({ orders, open });
  } catch (error) {
    const mapped = tradingErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
