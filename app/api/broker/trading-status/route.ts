import { NextResponse } from 'next/server';
import { requireBrokerAdmin } from '@/lib/webull/require-admin';
import { requireWebullConfig, getMaxNotionalUsd, getMaxQty, isLiveTradingEnabled, isTradingEnabled } from '@/lib/webull/config';
import { getKillSwitch } from '@/lib/webull/audit';
import { tradingStatus } from '@/lib/webull/orders';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireBrokerAdmin();
  if ('error' in auth) return auth.error;

  const cfg = requireWebullConfig();
  const status = await tradingStatus();
  return NextResponse.json({
    ...status,
    configured: cfg.ok && status.configured,
    envTradingEnabled: isTradingEnabled(),
    envLiveEnabled: isLiveTradingEnabled(),
    killSwitch: await getKillSwitch(),
    maxNotionalUsd: getMaxNotionalUsd(),
    maxQty: getMaxQty(),
  });
}
