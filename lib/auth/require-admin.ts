import 'server-only';

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isInsightsAdmin, syncAdminRole } from '@/lib/auth/admin';

export type AdminContext = { ok: true; userId: string; email: string; role: string | null };

/** Session gate for admin-only surfaces: broker trading, YouTube ingest, health. */
export async function requireAdmin(): Promise<AdminContext | { error: NextResponse }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const userId = (session.user as { id?: string })?.id;
  const email = session.user.email?.trim().toLowerCase();
  if (!userId || !email) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const role = await syncAdminRole(userId, email);
  if (!isInsightsAdmin(email, role)) {
    return { error: NextResponse.json({ error: 'Admin only' }, { status: 403 }) };
  }
  return { ok: true, userId, email, role };
}
