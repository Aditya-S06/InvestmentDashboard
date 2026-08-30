import { NextResponse } from 'next/server';
import { requireBrokerAdmin } from '@/lib/webull/require-admin';
import { cancelOrder, tradingErrorResponse } from '@/lib/webull/orders';
import { requestIp } from '@/lib/webull/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ clientOrderId: string }> };

export async function POST(_request: Request, context: Ctx) {
  const auth = await requireBrokerAdmin();
  if ('error' in auth) return auth.error;
  try {
    const { clientOrderId } = await context.params;
    const result = await cancelOrder(auth.userId, clientOrderId, requestIp());
    return NextResponse.json(result);
  } catch (error) {
    const mapped = tradingErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
