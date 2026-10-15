import { createHmac } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

type Database = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;

/** Atomic fixed windows; the database clock and unique key arbitrate all instances. */
export async function consumeDatabaseRateLimit(db: Database, input: string, limit: number, windowMs: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) throw new Error('Invalid rate limit');
  if (!process.env.NEXTAUTH_SECRET) throw new Error('Rate limit secret is missing');
  const key = createHmac('sha256', process.env.NEXTAUTH_SECRET)
    .update(JSON.stringify([input, limit, windowMs])).digest('hex');
  // Indexed, bounded cleanup. Recheck expiry after row locking to avoid deleting a renewed bucket.
  await db.$executeRaw`
    DELETE FROM "AuthRateLimit" WHERE "key" IN
      (SELECT "key" FROM "AuthRateLimit" WHERE "resetAt" <= statement_timestamp() ORDER BY "resetAt" LIMIT 100)
      AND "resetAt" <= statement_timestamp()`;
  const rows = await db.$queryRaw<Array<{ count: number; retryAfterSec: number }>>`
    INSERT INTO "AuthRateLimit" ("key", "count", "resetAt")
    VALUES (${key}, 1, statement_timestamp() + (${windowMs} * interval '1 millisecond'))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "AuthRateLimit"."resetAt" <= statement_timestamp() THEN 1
                     ELSE LEAST("AuthRateLimit"."count" + 1, ${limit + 1}) END,
      "resetAt" = CASE WHEN "AuthRateLimit"."resetAt" <= statement_timestamp()
                       THEN statement_timestamp() + (${windowMs} * interval '1 millisecond')
                       ELSE "AuthRateLimit"."resetAt" END
    RETURNING "count", GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("resetAt" - statement_timestamp()))))::integer AS "retryAfterSec"`;
  if (rows.length !== 1) throw new Error('Rate limiter returned no result');
  return { allowed: rows[0].count <= limit, remaining: Math.max(0, limit - rows[0].count), retryAfterSec: rows[0].retryAfterSec };
}
