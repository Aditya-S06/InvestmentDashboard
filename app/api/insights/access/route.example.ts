/**
 * Copy to route.ts — insights access probe (+ optional admin user list).
 * route.ts is gitignored and never committed.
 */
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  isInsightsAdmin,
  resolveOpenRouterKey,
  syncAdminRole,
} from '@/lib/insights/access';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as { id?: string })?.id;
  const email = session.user.email?.trim().toLowerCase();
  if (!userId || !email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = await syncAdminRole(userId, email);
  const isAdmin = isInsightsAdmin(email, role);
  const resolved = await resolveOpenRouterKey(userId, email, role);

  return NextResponse.json({
    hasAccess: !!resolved,
    source: resolved?.source ?? null,
    isAdmin,
    role: role ?? 'user',
    adminKeyConfigured: isAdmin && !!process.env.OPENROUTER_API_KEY?.trim(),
    // TODO: add admin-only user enumeration only if you need it locally
  });
}
