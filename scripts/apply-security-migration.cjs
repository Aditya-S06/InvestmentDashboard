// Existing deployments use Supabase's migration ledger. New Prisma-managed installs
// should use prisma migrate deploy instead. This applies ONLY the additive limiter migration.
const fs = require('node:fs');
const { createPrismaClient } = require('./prisma-client.cjs');
require('dotenv').config();
const db = createPrismaClient();
const version = '20261011000000';
const name = 'shared_auth_rate_limit';
const sql = fs.readFileSync(`prisma/migrations/${version}_${name}/migration.sql`, 'utf8');
// This file contains plain statements and one DO $$ block; reject unparsed SQL.
const clean = sql.replace(/^--.*$/gm, '').trim();
const statements = clean.match(/DO \$\$[\s\S]*?END \$\$;|[^\s;][^;]*;/g)?.map(s => s.trim()) || [];
if (statements.join('').replace(/\s/g, '') !== clean.replace(/\s/g, '')) throw new Error('Unparsed migration SQL');
(async () => {
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(61011000000::bigint)::text`;
    const done = await tx.$queryRaw`SELECT version FROM supabase_migrations.schema_migrations WHERE version = ${version}`;
    if (done.length) { console.log('Security migration already recorded.'); return; }
    for (const statement of statements) await tx.$executeRawUnsafe(statement);
    await tx.$executeRaw`INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES (${version}, ${name}, ${statements}::text[])`;
  });
  console.log('Shared rate-limit migration applied and recorded.');
})().catch(e => {
  console.error('Security migration failed:', e.code || e.name, e.meta?.code || '');
  process.exitCode = 1;
}).finally(() => db.$disconnect());
