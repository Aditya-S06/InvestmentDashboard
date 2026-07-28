export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { journalError, journalJson, requireJournalUser } from '@/lib/journal/http';
import { buildPersonalAnalytics } from '@/lib/journal/service';

export async function GET() {
  const userId = await requireJournalUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const analytics = await buildPersonalAnalytics(userId);
    return journalJson(analytics);
  } catch (error) {
    return journalError(error);
  }
}
