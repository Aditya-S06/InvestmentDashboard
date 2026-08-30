import { NextResponse } from 'next/server';
import { requireBrokerAdmin } from '@/lib/webull/require-admin';
import { getWebullEnvironment, isWebullConfigured } from '@/lib/webull/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireBrokerAdmin();
  if ('error' in auth) return auth.error;

  return NextResponse.json({
    configured: isWebullConfigured(),
    environment: getWebullEnvironment(),
  });
}
