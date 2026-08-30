export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireBrokerAdmin } from '@/lib/webull/require-admin';
import { serverError } from '@/lib/http/errors';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const auth = await requireBrokerAdmin();
  if ('error' in auth) return auth.error;

  try {
    const rows = await prisma.brokerAuditLog.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        action: true,
        environment: true,
        clientOrderId: true,
        ip: true,
        createdAt: true,
      },
    });
    return NextResponse.json({
      entries: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    });
  } catch (error) {
    return serverError('broker/audit', error, 'Could not load the audit log');
  }
}
