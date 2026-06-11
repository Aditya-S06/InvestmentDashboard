export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { runPython } from '@/lib/python-runner';

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol');
  if (!symbol) return NextResponse.json({ error: 'Symbol required' }, { status: 400 });
  try {
    const data = await runPython(['ticker', symbol]);
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch ticker data' }, { status: 500 });
  }
}
