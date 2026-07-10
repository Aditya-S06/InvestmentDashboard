import { NextRequest, NextResponse } from 'next/server';
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

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;

  const cfg = requireWebullConfig();
  if (!cfg.ok) return NextResponse.json({ error: cfg.error, positions: [] }, { status: 503 });

  const accountId = req.nextUrl.searchParams.get('accountId')?.trim();
  if (!accountId) {
    return NextResponse.json({ error: 'accountId required', positions: [] }, { status: 400 });
  }

  try {
    const data = await runWebull(['positions', accountId]);
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to load positions', positions: [] }, { status: 500 });
  }
}
