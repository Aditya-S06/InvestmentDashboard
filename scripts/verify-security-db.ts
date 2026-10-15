// Explicit operator integration check; only writes and removes a unique synthetic limiter bucket.
import { PrismaClient } from '@prisma/client';
import { createHmac, randomUUID } from 'node:crypto';
import { consumeDatabaseRateLimit } from '../lib/auth/rate-limit-db';
import { decryptApiKey } from '../lib/security/api-key-crypto';
const clients = [new PrismaClient(), new PrismaClient(), new PrismaClient()];
const input = `security-check:${randomUUID()}`;
const limit = 5, windowMs = 60000;
const key = createHmac('sha256', process.env.NEXTAUTH_SECRET || '').update(JSON.stringify([input, limit, windowMs])).digest('hex');
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function main() {
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => consumeDatabaseRateLimit(clients[i % 2], input, limit, windowMs)));
  check(results.filter(result => result.allowed).length === limit, 'Concurrent limit mismatch');
  await clients[0].$disconnect();
  check(!(await consumeDatabaseRateLimit(clients[2], input, limit, windowMs)).allowed, 'New client reset the counter');
  await clients[2].$executeRaw`UPDATE "AuthRateLimit" SET "resetAt" = statement_timestamp() - interval '1 second' WHERE "key" = ${key}`;
  check((await consumeDatabaseRateLimit(clients[2], input, limit, windowMs)).allowed, 'Expired window did not reset');
  const rows = await clients[2].apiKey.findMany();
  for (const row of rows) decryptApiKey(row.apiKey, row);
  const flags = await clients[2].$queryRaw<Array<{ rls: boolean; forced: boolean; anon: boolean; authenticated: boolean }>>`
    SELECT relrowsecurity AS rls, relforcerowsecurity AS forced,
      has_table_privilege('anon', 'public."AuthRateLimit"', 'SELECT,INSERT,UPDATE,DELETE') AS anon,
      has_table_privilege('authenticated', 'public."AuthRateLimit"', 'SELECT,INSERT,UPDATE,DELETE') AS authenticated
    FROM pg_class WHERE oid = 'public."AuthRateLimit"'::regclass`;
  check(flags[0]?.rls && flags[0]?.forced && !flags[0]?.anon && !flags[0]?.authenticated, 'Counter table API exposure');
  console.log(JSON.stringify({ concurrentRequests: 20, allowed: limit, crossClientPersistence: true, expiry: true, encryptedKeysVerified: rows.length, counterTablePrivate: true }));
}
main().catch(() => { console.error('Security database verification failed; no secrets logged.'); process.exitCode = 1; })
  .finally(async () => {
    try { await clients[2].$executeRaw`DELETE FROM "AuthRateLimit" WHERE "key" = ${key}`; }
    finally { await Promise.all(clients.map(client => client.$disconnect())); }
  });
