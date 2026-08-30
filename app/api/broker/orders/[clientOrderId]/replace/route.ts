import { NextResponse } from 'next/server';
import { requireBrokerAdmin } from '@/lib/webull/require-admin';
import { replaceOrder, tradingErrorResponse } from '@/lib/webull/orders';
import { requestIp } from '@/lib/webull/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ clientOrderId: string }> };

export async function POST(request: Request, context: Ctx) {
  const auth = await requireBrokerAdmin();
  if ('error' in auth) return auth.error;
  try {
    const { clientOrderId } = await context.params;
    const body = await request.json();
    const result = await replaceOrder(
      auth.userId,
      clientOrderId,
      {
        quantity: body.quantity != null ? Number(body.quantity) : undefined,
        limitPrice: body.limitPrice != null ? Number(body.limitPrice) : undefined,
      },
      requestIp(),
    );
    return NextResponse.json(result);
  } catch (error) {
    const mapped = tradingErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
