import 'server-only';

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export type SessionUser = { userId: string; email: string | null };

/** Shared session gate for any authenticated API route. */
export async function requireUser(): Promise<SessionUser | NextResponse> {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return { userId, email: session?.user?.email?.trim().toLowerCase() ?? null };
}
