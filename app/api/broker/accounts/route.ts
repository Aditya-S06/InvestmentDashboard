import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isInsightsAdmin, syncAdminRole } from '@/lib/insights/access';
import { requireWebullConfig } from '@/lib/webull/config';
import { runWebull } from '@/lib/python-runner';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const userId = (session.user as { id?: string })?.id;
  const email = session.user.email?.trim().toLowerCase();
  if (!userId || !email) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const role = await syncAdminRole(userId, email);
  if (!isInsightsAdmin(email, role)) {
    return { error: NextResponse.json({ error: 'Admin only' }, { status: 403 }) };
  }
  return { ok: true as const };
}

export async function GET() {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;

  const cfg = requireWebullConfig();
  if (!cfg.ok) return NextResponse.json({ error: cfg.error, accounts: [] }, { status: 503 });

  try {
    const data = await runWebull(['accounts']);
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to load accounts', accounts: [] }, { status: 500 });
  }
}
