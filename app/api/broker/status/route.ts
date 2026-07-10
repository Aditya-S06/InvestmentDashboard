import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isInsightsAdmin, syncAdminRole } from '@/lib/insights/access';
import { getWebullEnvironment, isWebullConfigured } from '@/lib/webull/config';

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
  return { userId, email, role };
}

export async function GET() {
  const auth = await requireAdmin();
  if ('error' in auth && auth.error) return auth.error;

  return NextResponse.json({
    configured: isWebullConfigured(),
    environment: getWebullEnvironment(),
  });
}
