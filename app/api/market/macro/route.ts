export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { runPython } from '@/lib/python-runner';

export async function GET() {
  try {
    const data = await runPython(['macro']);
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed' }, { status: 500 });
  }
}
