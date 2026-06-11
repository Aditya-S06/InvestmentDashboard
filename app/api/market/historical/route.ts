export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { runPython } from '@/lib/python-runner';

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol');
  const period = req.nextUrl.searchParams.get('period') || '6mo';
  if (!symbol) return NextResponse.json({ error: 'Symbol required' }, { status: 400 });
  try {
    const data = await runPython(['historical', symbol, period]);
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed' }, { status: 500 });
  }
}
