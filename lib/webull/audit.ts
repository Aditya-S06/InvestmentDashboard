import 'server-only';

import { prisma } from '@/lib/prisma';
import { getWebullEnvironment } from './config';

export async function writeBrokerAudit(input: {
  userId: string;
  action: string;
  clientOrderId?: string | null;
  ip?: string | null;
  payload?: unknown;
  result?: unknown;
}) {
  await prisma.brokerAuditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      environment: getWebullEnvironment(),
      clientOrderId: input.clientOrderId ?? undefined,
      ip: input.ip ?? undefined,
      payload: input.payload as object | undefined,
      result: input.result as object | undefined,
    },
  });
}

export async function getKillSwitch(): Promise<boolean> {
  const row = await prisma.tradingSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', killSwitch: false },
    update: {},
  });
  return row.killSwitch;
}

export async function setKillSwitch(userId: string, enabled: boolean) {
  const row = await prisma.tradingSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', killSwitch: enabled, updatedBy: userId },
    update: { killSwitch: enabled, updatedBy: userId },
  });
  await writeBrokerAudit({
    userId,
    action: 'kill',
    payload: { killSwitch: enabled },
    result: { killSwitch: row.killSwitch },
  });
  return row;
}
