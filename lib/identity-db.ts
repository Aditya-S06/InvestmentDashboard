import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '@/lib/database/client';

// This role has access to identity records/counters only, never watchlists, keys, research or orders.
const globals = globalThis as unknown as { identityDatabase?: PrismaClient };
const base = globals.identityDatabase ?? createPrismaClient(
  process.env.AUTH_DATABASE_URL || 'postgresql://missing:missing@127.0.0.1:1/missing',
);
if (process.env.NODE_ENV !== 'production') globals.identityDatabase = base;
let checked: Promise<void> | undefined;
async function assertRole() {
  if (!checked) checked = (async () => {
    const rows = await base.$queryRaw<Array<{ safe: boolean }>>`
      SELECT current_user = 'oracle_identity'
        AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb)
        AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid)
        AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
        AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
          AND (c.relowner = r.oid OR (c.relkind = 'r' AND c.relname NOT IN ('User', 'AuthRateLimit')
            AND has_table_privilege(current_user, c.oid, 'SELECT,INSERT,UPDATE,DELETE')))) AS safe
      FROM pg_roles r WHERE r.rolname = current_user`;
    if (!rows[0]?.safe) throw new Error('Identity database role is not restricted');
  })().catch(error => { checked = undefined; throw error; });
  await checked;
}
export const identityDb: PrismaClient = new Proxy(base, {
  get(target, property) {
    if (property === '$disconnect') return target.$disconnect.bind(target);
    if (property === '$queryRaw' || property === '$executeRaw') return async (...args: unknown[]) => {
      await assertRole(); return (target[property] as any)(...args);
    };
    if (property === 'user' || property === 'authRateLimit') return new Proxy(target[property], {
      get(delegate, operation) { return async (...args: unknown[]) => {
        await assertRole(); return (delegate as any)[operation](...args);
      }; },
    });
    throw new Error('Identity database operation unavailable');
  },
});
