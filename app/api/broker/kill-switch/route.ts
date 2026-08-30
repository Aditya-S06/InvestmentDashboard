import { NextResponse } from 'next/server';
import { requireBrokerAdmin } from '@/lib/webull/require-admin';
import { setKillSwitch, getKillSwitch } from '@/lib/webull/audit';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireBrokerAdmin();
  if ('error' in auth) return auth.error;
  return NextResponse.json({ killSwitch: await getKillSwitch() });
}

export async function POST(request: Request) {
  const auth = await requireBrokerAdmin();
  if ('error' in auth) return auth.error;
  const body = await request.json().catch(() => ({}));
  const enabled = Boolean(body.enabled ?? body.killSwitch);
  const row = await setKillSwitch(auth.userId, enabled);
  return NextResponse.json({ killSwitch: row.killSwitch });
}
