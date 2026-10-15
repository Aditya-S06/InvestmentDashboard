// Explicit operator setup. Schema push cannot install security policies/roles.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');
dotenv.config();
function run(script, args=[], env=process.env) {
  const result=spawnSync(process.execPath,[script,...args],{env,stdio:'inherit',windowsHide:true});
  if (result.error || result.status!==0) throw new Error('Setup command failed');
}
async function main() {
  if (!fs.existsSync('.env.migrations')) {
    const url=process.env.DATABASE_URL;
    if (!url || decodeURIComponent(new URL(url).username).startsWith('oracle_')) throw new Error('Provide operator DATABASE_URL and DIRECT_URL in .env.migrations first');
    fs.writeFileSync('.env.migrations',`DATABASE_URL=${JSON.stringify(url)}\nDIRECT_URL=${JSON.stringify(process.env.DIRECT_URL||url)}\n`,{mode:0o600,flag:'wx'});
  }
  const operator=dotenv.parse(fs.readFileSync('.env.migrations'));
  const commandEnv={...process.env,DATABASE_URL:operator.DATABASE_URL,DIRECT_URL:operator.DIRECT_URL};
  const db=new PrismaClient({datasources:{db:{url:operator.DATABASE_URL}}});
  try {
    const [state]=await db.$queryRaw`SELECT to_regclass('supabase_migrations.schema_migrations')::text AS supabase,
      to_regclass('public."_prisma_migrations"')::text AS prisma, to_regclass('public."User"')::text AS users`;
    if (!state.supabase) {
      if (state.users && !state.prisma) throw new Error('Existing db-push database needs an operator-reviewed migration baseline; see docs/identity-hardening.md');
      // Plain local Postgres needs the same API-role names referenced by historical SQL.
      await db.$executeRawUnsafe(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      END $$;`);
      run(require.resolve('prisma/build/index.js'),['migrate','deploy'],commandEnv);
    }
  } finally {await db.$disconnect();}
  run(require.resolve('prisma/build/index.js'),['generate'],commandEnv);
  run('scripts/harden-database.cjs');
  run(require.resolve('tsx/cli'),['scripts/verify-identity-db.ts']);
  run('scripts/harden-database.cjs',['--activate']);
  run(require.resolve('prisma/build/index.js'),['db','seed'],commandEnv);
  console.log('Database setup verified. Start the app with the restricted URLs now in .env.');
}
main().catch(error=>{console.error('Database setup stopped:',error.code||error.message);process.exitCode=1;});
