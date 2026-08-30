import { NextResponse } from 'next/server';
import { requireBrokerAdmin } from '@/lib/webull/require-admin';
import { parseTicket, placeOrder, tradingErrorResponse } from '@/lib/webull/orders';
import { requestIp } from '@/lib/webull/http';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireBrokerAdmin();
  if ('error' in auth) return auth.error;
  try {
    const body = await request.json();
    const ticket = parseTicket(body);
    const result = await placeOrder(auth.userId, ticket, requestIp());
    return NextResponse.json(result);
  } catch (error) {
    const mapped = tradingErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
