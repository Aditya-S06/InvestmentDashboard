export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { runPython } from '@/lib/python-runner';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q');
  if (!q) return NextResponse.json([]);
  try {
    const data = await runPython(['search', q]);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([]);
  }
}
