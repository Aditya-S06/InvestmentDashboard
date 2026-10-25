// Uses synthetic rows only; never prints connection strings, passwords or keys.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createPrismaClient } from '../lib/database/client';
import { parse } from 'dotenv';
import { scopedPrisma } from '../lib/database/scoped-client';
const operator = parse(fs.readFileSync('.env.migrations'));
const runtime = parse(fs.readFileSync('.env.runtime.pending'));
const make = (url: string) => createPrismaClient(url);
const admin = make(operator.DATABASE_URL), base = make(runtime.DATABASE_URL), identity = make(runtime.AUTH_DATABASE_URL);
const a = `security_${randomUUID()}`, b = `security_${randomUUID()}`;
const alice = scopedPrisma(base, async () => ({ userId:a, sessionVersion:0, admin:false }));
const bob = scopedPrisma(base, async () => ({ userId:b, sessionVersion:0, admin:false }));
async function main() {
  await identity.user.createMany({ data:[{id:a,email:`${a}@invalid.test`},{id:b,email:`${b}@invalid.test`}] });
  await alice.watchlist.create({data:{userId:a,ticker:'TESTA'}});
  await bob.watchlist.create({data:{userId:b,ticker:'TESTB'}});
  assert.equal(await base.watchlist.count(),0, 'no context must deny reads');
  assert.equal((await alice.watchlist.findMany()).length,1, 'omitted user predicate must still isolate');
  assert.equal((await bob.watchlist.findMany())[0].ticker,'TESTB');
  assert.equal(await base.watchlist.count(),0, 'context must not survive pooled transaction');
  assert.equal((await alice.watchlist.updateMany({where:{userId:b},data:{ticker:'BAD'}})).count,0);
  assert.equal((await alice.watchlist.deleteMany({where:{userId:b}})).count,0);
  await assert.rejects(() => alice.watchlist.create({data:{userId:b,ticker:'BAD'}}));
  await assert.rejects(() => alice.watchlist.updateMany({data:{userId:b}}));
  const sessionA = await alice.insightSession.create({data:{userId:a}});
  const sessionB = await bob.insightSession.create({data:{userId:b}});
  const message = await alice.insightMessage.create({data:{sessionId:sessionA.id,role:'user',content:'synthetic'}});
  await assert.rejects(() => alice.insightMessage.update({where:{id:message.id},data:{sessionId:sessionB.id}}));
  await assert.rejects(() => alice.insightMessage.create({data:{sessionId:sessionB.id,role:'user',content:'synthetic'}}));
  assert.equal(await bob.insightMessage.count(),0);
  await assert.rejects(() => base.user.findMany(), 'runtime cannot read passwords/MFA');
  await assert.rejects(() => identity.watchlist.findMany(), 'identity has no domain rights');
  await assert.rejects(() => base.$executeRawUnsafe('CREATE TABLE public.security_probe(id int)'), 'runtime cannot create schema objects');
  for (const db of [base,identity]) {
    const roles = await db.$queryRaw<Array<{safe:boolean}>>`SELECT NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)
      AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid)
      AND NOT has_schema_privilege(current_user,'public','CREATE') AS safe FROM pg_roles r WHERE rolname=current_user`;
    assert(roles[0].safe, 'role must not have elevated attributes or memberships');
  }
  await identity.user.update({where:{id:a},data:{sessionVersion:{increment:1}}});
  await assert.rejects(() => alice.watchlist.findMany(), 'old version rejected');
  const updated = scopedPrisma(base, async () => ({userId:a,sessionVersion:1,admin:false}));
  assert.equal(await updated.watchlist.count(),1);
  await updated.$transaction(async tx => {
    assert.equal(await tx.watchlist.count(),1);
    await tx.user.updateMany({where:{id:a},data:{disabledAt:new Date(),sessionVersion:{increment:1}}});
  });
  await assert.rejects(() => updated.watchlist.findMany(), 'disabled user rejected');
  await identity.user.delete({where:{id:a}});
  assert.equal(await admin.watchlist.count({where:{userId:a}}),0, 'delete cascades app rows');
  assert.equal(await admin.insightMessage.count({where:{id:message.id}}),0);
  const policies = await admin.$queryRaw<Array<{tableName:string}>>`SELECT c.relname AS "tableName" FROM pg_class c
    WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND c.relname NOT LIKE '\\_%'
    AND NOT c.relrowsecurity`;
  assert.equal(policies.length,0,'all application tables must enable RLS');
  console.log('PASS: real restricted logins, no-context denial, pooled context isolation, ownership writes, child relationships, no identity/domain crossover, no DDL/elevation, stale/disabled sessions, deletion cascades and RLS coverage.');
}
main().catch(error => { console.error('Identity database verification failed:', error.code || error.name, error instanceof assert.AssertionError ? error.message : '', error.meta?.code || ''); process.exitCode=1; })
 .finally(async () => {
   try { await admin.user.deleteMany({where:{id:{in:[a,b]}}}); }
   finally { await Promise.all([admin,base,identity].map(db => db.$disconnect())); }
 });
