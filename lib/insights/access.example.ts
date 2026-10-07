/**
 * Copy this file to access.ts and implement your access / key-resolution logic.
 * access.ts is gitignored and never committed.
 */
import 'server-only';

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isInsightsAdmin, syncAdminRole } from '@/lib/auth/admin';
export { isInsightsAdmin, syncAdminRole } from '@/lib/auth/admin';

export type InsightsKeySource = 'admin' | 'user';

export interface ResolvedOpenRouterKey {
  key: string;
  source: InsightsKeySource;
}

export async function resolveOpenRouterKey(
  userId: string,
  email?: string | null,
  role?: string | null,
): Promise<ResolvedOpenRouterKey | null> {
  // TODO: admin → process.env.OPENROUTER_API_KEY; others → ApiKey table (provider: openrouter)
  void userId;
  void email;
  void role;
  return null;
}

export function canUseAdminInsights(email?: string | null, role?: string | null) {
  return isInsightsAdmin(email, role);
}

export type InsightsAccessContext = {
  userId: string;
  email: string;
  role: string | null;
  isAdmin: boolean;
  key: ResolvedOpenRouterKey;
};

export async function requireInsightsAccess(): Promise<InsightsAccessContext | NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as { id?: string })?.id;
  const email = session.user.email?.trim().toLowerCase();
  if (!userId || !email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = await syncAdminRole(userId, email);
  const isAdmin = isInsightsAdmin(email, role);
  const key = await resolveOpenRouterKey(userId, email, role);

  if (!key) {
    if (isAdmin) {
      return NextResponse.json(
        { error: 'Admin OpenRouter key not configured. Set OPENROUTER_API_KEY in the server .env file.' },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: 'OpenRouter API key required. Add your key in Settings to use AI Insights.' },
      { status: 403 },
    );
  }

  return { userId, email, role, isAdmin, key };
}
