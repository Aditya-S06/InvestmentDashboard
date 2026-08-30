export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/prisma';
import { runPython } from '@/lib/python-runner';
import { getWebullEnvironment, isTradingEnabled, isWebullConfigured } from '@/lib/webull/config';
import { youtubeApiConfigured } from '@/lib/youtube/channels';

type Check = { name: string; ok: boolean; detail?: string };

async function checkDatabase(): Promise<Check> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { name: 'database', ok: true };
  } catch (error) {
    return { name: 'database', ok: false, detail: error instanceof Error ? error.message : 'unreachable' };
  }
}

async function checkPython(): Promise<Check> {
  try {
    const data = await runPython(['ticker', 'AAPL']);
    const price = Number(data?.price);
    return price > 0
      ? { name: 'python', ok: true, detail: 'market_data.py responded' }
      : { name: 'python', ok: false, detail: 'no quote returned' };
  } catch (error) {
    return { name: 'python', ok: false, detail: error instanceof Error ? error.message : 'failed' };
  }
}

export async function GET() {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;

  const [database, python] = await Promise.all([checkDatabase(), checkPython()]);

  const checks: Check[] = [
    database,
    python,
    {
      name: 'webull',
      ok: isWebullConfigured(),
      detail: isWebullConfigured()
        ? `${getWebullEnvironment()} · trading ${isTradingEnabled() ? 'enabled' : 'off'}`
        : 'WEBULL_APP_KEY / WEBULL_APP_SECRET not set',
    },
    {
      name: 'openrouter',
      ok: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
      detail: process.env.OPENROUTER_API_KEY?.trim() ? undefined : 'OPENROUTER_API_KEY not set',
    },
    {
      name: 'youtube',
      ok: youtubeApiConfigured(),
      detail: youtubeApiConfigured() ? undefined : 'YOUTUBE_API_KEY not set',
    },
  ];

  // Only the database and Python runtime are required for the desk to function.
  const healthy = database.ok && python.ok;
  return NextResponse.json(
    { ok: healthy, checkedAt: new Date().toISOString(), checks },
    { status: healthy ? 200 : 503 },
  );
}
