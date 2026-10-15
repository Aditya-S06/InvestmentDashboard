import { PrismaClient } from '@prisma/client';
import { scopedPrisma } from '@/lib/database/scoped-client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const base = globalForPrisma.prisma ?? new PrismaClient();
export const prisma = scopedPrisma(base, async () => {
  // Lazy imports break the auth -> identity database cycle and resolve the current request afresh.
  const [{ getServerSession }, { authOptions }, { isInsightsAdmin }] = await Promise.all([
    import('next-auth'), import('@/lib/auth'), import('@/lib/auth/admin'),
  ]);
  const session = await getServerSession(authOptions);
  const user = session?.user as { id?: string; email?: string; sessionVersion?: number } | undefined;
  if (!user?.id || user.sessionVersion === undefined) throw new Error('Database identity required');
  return { userId: user.id, sessionVersion: user.sessionVersion, admin: isInsightsAdmin(user.email) };
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = base;
