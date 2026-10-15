import type { PrismaClient, Prisma } from '@prisma/client';

export type DatabaseIdentity = { userId: string; sessionVersion: number; admin: boolean };

/** All context is transaction-local, including through a transaction pooler. No process-global tenant state. */
export function scopedPrisma(base: PrismaClient, identity: () => Promise<DatabaseIdentity>): PrismaClient {
  let roleCheck: Promise<void> | undefined;
  async function assertRole() {
    if (!roleCheck) roleCheck = (async () => {
      const rows = await base.$queryRaw<Array<{ safe: boolean }>>`
        SELECT NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb)
          AND current_user = 'oracle_runtime'
          AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid)
          AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
          AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relowner = r.oid)
          AS safe FROM pg_roles r WHERE r.rolname = current_user`;
      if (!rows[0]?.safe) throw new Error('Runtime database role is not restricted');
    })().catch(error => { roleCheck = undefined; throw error; });
    await roleCheck;
  }
  async function transaction(work: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: object) {
    const who = await identity();
    if (!who.userId || !Number.isInteger(who.sessionVersion)) throw new Error('Database identity required');
    await assertRole();
    return base.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${who.userId}, true),
        set_config('app.session_version', ${String(who.sessionVersion)}, true),
        set_config('app.is_admin', ${who.admin ? 'true' : 'false'}, true)`;
      // Serialize account deletion with new work reservations for this user.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${who.userId}, 0))::text`;
      const active = await tx.user.findFirst({ where: { id: who.userId, sessionVersion: who.sessionVersion, disabledAt: null }, select: { id: true } });
      if (!active) throw new Error('Database session is no longer active');
      return work(tx);
    }, options);
  }
  return new Proxy(base, {
    get(target, property) {
      if (property === '$transaction') return (work: unknown, options?: object) => {
        if (typeof work !== 'function') throw new Error('Use an interactive transaction for scoped database access');
        return transaction(work as (tx: Prisma.TransactionClient) => Promise<unknown>, options);
      };
      if (typeof property === 'string' && ['$queryRaw', '$executeRaw'].includes(property)) {
        return (...args: unknown[]) => transaction(tx => (tx as any)[property](...args));
      }
      if (typeof property !== 'string' || property.startsWith('$') || property.startsWith('_')) {
        if (property === '$disconnect') return target.$disconnect.bind(target);
        throw new Error('Unscoped database operation is unavailable');
      }
      const value = (target as any)[property];
      if (!value || typeof value !== 'object') return value;
      return new Proxy(value, { get(_delegate, operation) {
        return (...args: unknown[]) => transaction(tx => (tx as any)[property][operation](...args));
      } });
    },
  });
}
