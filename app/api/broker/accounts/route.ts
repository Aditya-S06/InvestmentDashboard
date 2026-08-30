import { NextResponse } from 'next/server';
import { requireWebullConfig } from '@/lib/webull/config';
import { requireBrokerAdmin } from '@/lib/webull/require-admin';
import { brokerPythonError } from '@/lib/webull/payload';
import { runWebull } from '@/lib/python-runner';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireBrokerAdmin();
  if ('error' in auth) return auth.error;

  const cfg = requireWebullConfig();
  if (!cfg.ok) return NextResponse.json({ error: cfg.error, accounts: [] }, { status: 503 });

  try {
    const data = await runWebull(['accounts']);
    const pythonError = brokerPythonError(data, { accounts: [] });
    if (pythonError) return pythonError;
    if (!Array.isArray(data?.accounts)) {
      return NextResponse.json(
        { error: 'Invalid accounts response from Webull client', accounts: [] },
        { status: 502 },
      );
    }
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to load accounts', accounts: [] }, { status: 500 });
  }
}
