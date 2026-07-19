export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { paperError, paperJson, readJsonObject, requirePaperUser } from '@/lib/paper/http';
import { getOrCreatePaperAccount, updatePaperAccount } from '@/lib/paper/service';

export async function GET() {
  const userId = await requirePaperUser();
  if (userId instanceof NextResponse) return userId;
  try {
    return paperJson(await getOrCreatePaperAccount(userId));
  } catch (error) {
    return paperError(error);
  }
}

export async function POST(request: Request) {
  const userId = await requirePaperUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const body = await readJsonObject(request);
    return paperJson(
      await updatePaperAccount(userId, {
        startingEquity: body.startingEquity,
        currency: body.currency,
      }),
    );
  } catch (error) {
    return paperError(error);
  }
}
