// Operator-only: apply reviewed SQL, provision restricted logins, and save candidate
// configuration. Activation is separate so integration checks can run before cutover.
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const { createPrismaClient } = require('./prisma-client.cjs');
const dotenv = require('dotenv');
const envText = fs.readFileSync('.env', 'utf8');
const env = dotenv.parse(envText);
const operatorFile = '.env.migrations';
const pendingFile = '.env.runtime.pending';
function write(file, data) { fs.writeFileSync(file, data, { mode: 0o600, flag: 'wx' }); }
function serialized(values) { return Object.entries(values).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join('\n') + '\n'; }
function runtimeUrl(source, role, password) {
  const url = new URL(source);
  const suffix = decodeURIComponent(url.username).includes('.') ? '.' + decodeURIComponent(url.username).split('.').slice(1).join('.') : '';
  url.username = role + suffix; url.password = password;
  url.searchParams.set('connection_limit', '3');
  return url.toString();
}
function statements(sql) {
  const clean = sql.replace(/^--.*$/gm, '').trim();
  const parts = clean.match(/DO \$\$[\s\S]*?END \$\$;|[^\s;][^;]*;/g)?.map(s => s.trim()) || [];
  if (parts.join('').replace(/\s/g,'') !== clean.replace(/\s/g,'')) throw new Error('Unparsed SQL');
  return parts;
}
async function main() {
  if (!fs.existsSync(operatorFile)) {
    if (decodeURIComponent(new URL(env.DATABASE_URL).username).startsWith('oracle_')) throw new Error('Migration credentials must be supplied separately');
    write(operatorFile, serialized({ DATABASE_URL: env.DATABASE_URL, DIRECT_URL: env.DIRECT_URL || env.DATABASE_URL }));
  }
  const operator = dotenv.parse(fs.readFileSync(operatorFile));
  const db = createPrismaClient(operator.DATABASE_URL);
  try {
    if (process.argv.includes('--activate')) {
      const pending = dotenv.parse(fs.readFileSync(pendingFile));
      for (const [key, role] of [['DATABASE_URL','oracle_runtime'],['AUTH_DATABASE_URL','oracle_identity']]) {
        const check = createPrismaClient(pending[key]);
        try {
          const rows = await check.$queryRaw`SELECT current_user AS name, rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb AS elevated FROM pg_roles WHERE rolname=current_user`;
          if (rows[0]?.name !== role || rows[0].elevated) throw new Error('Unsafe role');
        } finally { await check.$disconnect(); }
      }
      let result = envText;
      for (const [key,value] of Object.entries(pending)) {
        const line = `${key}=${JSON.stringify(value)}`;
        const re = new RegExp(`^${key}=.*$`, 'm');
        result = re.test(result) ? result.replace(re, () => line) : result + '\n' + line + '\n';
      }
      fs.writeFileSync('.env', result, { mode: 0o600 });
      console.log('Restricted runtime and identity URLs activated in .env. Restart the application.');
      return;
    }
    const ledger = await db.$queryRaw`SELECT to_regclass('supabase_migrations.schema_migrations')::text AS supabase`;
    for (const directory of ['20260910000000_trading_desk_runs', '20261011000000_shared_auth_rate_limit', '20261012000000_database_identity_hardening']) {
      const version = directory.slice(0,14), name = directory.slice(15);
      if (!ledger[0]?.supabase) {
        const applied = await db.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE migration_name=${directory} AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
        if (!applied.length) throw new Error('Run prisma migrate deploy using operator credentials first');
        continue;
      }
      const parts = statements(fs.readFileSync(`prisma/migrations/${directory}/migration.sql`, 'utf8'));
      await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(61012000000::bigint)::text`;
        const done = await tx.$queryRaw`SELECT version FROM supabase_migrations.schema_migrations WHERE version=${version}`;
        if (done.length) return;
        for (const sql of parts) await tx.$executeRawUnsafe(sql);
        await tx.$executeRaw`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (${version},${name},${parts}::text[])`;
      }, { timeout: 60000 });
      console.log(`Verified migration ${directory}`);
    }
    if (!fs.existsSync(pendingFile)) {
      const runtime = runtimeUrl(operator.DATABASE_URL, 'oracle_runtime', randomBytes(32).toString('hex'));
      const identity = runtimeUrl(operator.DATABASE_URL, 'oracle_identity', randomBytes(32).toString('hex'));
      write(pendingFile, serialized({ DATABASE_URL: runtime, DIRECT_URL: runtime, AUTH_DATABASE_URL: identity }));
    }
    const pending = dotenv.parse(fs.readFileSync(pendingFile));
    for (const [key,role] of [['DATABASE_URL','oracle_runtime'],['AUTH_DATABASE_URL','oracle_identity']]) {
      const password = decodeURIComponent(new URL(pending[key]).password);
      if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('Unexpected provisioned password');
      // Role names are constants; random hex is validated and never printed.
      await db.$executeRawUnsafe(`ALTER ROLE ${role} LOGIN PASSWORD '${password}'`);
    }
    console.log('Restricted logins provisioned. Run verification before --activate. No credentials logged.');
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error('Database hardening failed:', error.code || error.name, error.meta?.code || ''); process.exitCode=1; });
