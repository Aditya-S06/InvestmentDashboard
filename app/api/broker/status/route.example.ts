/**
 * Public stub — copy patterns from status/accounts/positions/balance routes.
 * Broker APIs are admin-only and require WEBULL_APP_KEY / WEBULL_APP_SECRET.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    configured: false,
    error: 'Configure app/api/broker/* routes and WEBULL_* env vars.',
  });
}
