export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { paperError, paperJson, readJsonObject, requirePaperUser } from '@/lib/paper/http';
import { resetPaperAccount } from '@/lib/paper/service';

export async function POST(request: Request) {
  const userId = await requirePaperUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const body = await readJsonObject(request);
    return paperJson({
      account: await resetPaperAccount(userId, body.startingEquity),
      reset: true,
    });
  } catch (error) {
    return paperError(error);
  }
}
