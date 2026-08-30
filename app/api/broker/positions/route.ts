import { NextRequest, NextResponse } from 'next/server';
import { requireWebullConfig } from '@/lib/webull/config';
import { requireBrokerAdmin } from '@/lib/webull/require-admin';
import { brokerPythonError } from '@/lib/webull/payload';
import { runWebull } from '@/lib/python-runner';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireBrokerAdmin();
  if ('error' in auth) return auth.error;

  const cfg = requireWebullConfig();
  if (!cfg.ok) return NextResponse.json({ error: cfg.error, positions: [] }, { status: 503 });

  const accountId = req.nextUrl.searchParams.get('accountId')?.trim();
  if (!accountId) {
    return NextResponse.json({ error: 'accountId required', positions: [] }, { status: 400 });
  }

  try {
    const data = await runWebull(['positions', accountId]);
    const pythonError = brokerPythonError(data, { positions: [], accountId });
    if (pythonError) return pythonError;
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to load positions', positions: [] }, { status: 500 });
  }
}
