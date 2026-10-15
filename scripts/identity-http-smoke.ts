// Isolated production HTTP test. Synthetic account only; no provider/broker calls.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { config, parse } from 'dotenv';
import { totp } from '../lib/auth/totp';
config();
const origin='http://127.0.0.1:3102';
const id=`security_http_${randomUUID()}`, email=`${id}@invalid.test`;
const password=randomBytes(24).toString('hex'), newPassword=randomBytes(24).toString('hex');
const authSecret=randomBytes(48).toString('hex');
const operator=parse(readFileSync('.env.migrations'));
const db=new PrismaClient({datasources:{db:{url:operator.DATABASE_URL}}});
const dataRoot=path.resolve('.data','security-http-fixture');
const userDir=path.join(dataRoot,id);
const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3102'],{
  env:{...process.env,NEXT_DIST_DIR:'.next/security-check',NEXTAUTH_URL:origin,NEXTAUTH_SECRET:authSecret,ALLOW_PUBLIC_SIGNUP:'false',ADMIN_EMAILS:email,DESK_DATA_ROOT:dataRoot},
  stdio:['ignore','pipe','pipe'],windowsHide:true,
});
let ready=false;
server.stdout.on('data', chunk => { if(chunk.toString().includes('Ready')) ready=true; });
server.stderr.on('data',()=>{});
const exited=new Promise(resolve=>server.on('exit',resolve));
const jar=new Map<string,string>();
let csrf='';
async function request(route:string, init:RequestInit={}) {
  const response=await fetch(origin+route,{...init,redirect:'manual',headers:{cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...init.headers}});
  for(const cookie of response.headers.getSetCookie()) {
    const pair=cookie.split(';')[0], split=pair.indexOf('='); jar.set(pair.slice(0,split),pair.slice(split+1));
  }
  return response;
}
async function login(pass:string, code='') {
  jar.delete('next-auth.session-token');
  const token=await request('/api/auth/csrf'); csrf=(await token.json()).csrfToken;
  const result=await request('/api/auth/callback/credentials',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',origin},
    body:new URLSearchParams({csrfToken:csrf,email,password:pass,code,json:'true'})});
  const payload=await result.json();
  return !String(payload.url).includes('error=');
}
async function action(body:Record<string,unknown>, status=200, method='POST') {
  const response=await request('/api/account/security',{method,headers:{origin,'x-csrf-token':csrf,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal(response.status,status, `Account action ${body.action || method} returned unexpected status`);
  return response.json();
}
async function main() {
  await db.user.create({data:{id,email,password:await bcrypt.hash(password,12)}});
  await fs.mkdir(userDir,{recursive:true}); await fs.writeFile(path.join(userDir,'fixture.txt'),'synthetic');
  for(let i=0;i<150&&!ready;i++) { if(server.exitCode!==null) throw new Error('Server exited'); await new Promise(r=>setTimeout(r,100)); }
  assert(ready);
  assert(await login(password));
  assert.equal((await request('/dashboard/security')).status,200);
  assert.equal((await request('/api/account/security')).status,200);
  const watch=await request('/api/watchlist',{method:'POST',headers:{origin,'x-csrf-token':csrf,'content-type':'application/json'},body:JSON.stringify({ticker:'SPY'})});
  assert.equal(watch.status,201,'authenticated scoped mutation');
  assert.equal((await request('/api/watchlist')).status,200);
  assert.equal((await request('/api/insights/access')).status,200,'admin role sync and nested scoped reads');
  await action({action:'mfa-begin',password:'incorrect'},403);
  const setup=await action({action:'mfa-begin',password});
  assert.match(setup.secret,/^[A-Z2-7]{32}$/);
  await action({action:'mfa-confirm',password,enrollmentCode:'bad-code'},400);
  const code=totp(setup.secret,Math.floor(Date.now()/30000));
  const enrolled=await action({action:'mfa-confirm',password,enrollmentCode:code});
  assert.equal(enrolled.recoveryCodes.length,10);
  const stored=await db.user.findUniqueOrThrow({where:{id}});
  assert(stored.mfaSecret?.startsWith('enc:v1:'));
  assert(!stored.mfaRecoveryHashes.includes(enrolled.recoveryCodes[0]));
  assert.equal((await request('/api/watchlist')).status,401,'enrollment revokes old cookie');
  assert.equal(await login(password,code),false,'used TOTP cannot log in again');
  assert.equal(await login(password),false,'MFA required');
  assert(await login(password,enrolled.recoveryCodes[0]),'recovery login works');
  const savedCookie=jar.get('next-auth.session-token')!;
  assert.equal(await login(password,enrolled.recoveryCodes[0]),false,'recovery cannot be reused');
  jar.set('next-auth.session-token',savedCookie);
  const status=await (await request('/api/account/security')).json();
  assert.deepEqual(status,{mfaEnabled:true,recoveryCodesRemaining:9});
  await action({action:'password',password,code:enrolled.recoveryCodes[1],newPassword});
  assert.equal((await request('/api/watchlist')).status,401,'password change revokes session');
  assert.equal(await login(password,enrolled.recoveryCodes[2]),false,'old password rejected');
  assert(await login(newPassword,enrolled.recoveryCodes[2]));
  await action({action:'logout-all',password:newPassword,code:enrolled.recoveryCodes[3]});
  assert.equal((await request('/api/watchlist')).status,401,'logout all revokes session');
  assert(await login(newPassword,enrolled.recoveryCodes[4]));
  await action({action:'mfa-disable',password:newPassword,code:enrolled.recoveryCodes[5]});
  assert(await login(newPassword));
  await action({password:newPassword,confirmation:'DELETE'},200,'DELETE');
  assert.equal(await db.user.count({where:{id}}),0);
  assert.equal(await db.watchlist.count({where:{userId:id}}),0);
  await assert.rejects(()=>fs.stat(userDir));
  assert.equal((await request('/api/watchlist')).status,401,'deleted account cannot reuse cookie');
  console.log('PASS: production credentials login, scoped reads/writes, admin sync, MFA enrollment/encryption/replay denial, one-use recovery, password change, session invalidation, MFA disable, account deletion and artifact cleanup.');
}
main().catch(error=>{console.error('Identity HTTP smoke failed:',error instanceof assert.AssertionError?error.message:error.code||error.name);process.exitCode=1;})
 .finally(async()=>{
   server.kill(); await exited;
   try {
     await db.user.deleteMany({where:{id}});
     // Only this server's synthetic auth buckets (unique test signing secret).
     const specs:Array<[string,number,number]>=[['login-ip:unknown',30,900000],[`login:unknown:${email}`,10,900000],[`login-email:${email}`,10,900000],[`account-security:${id}`,10,900000]];
     const keys=specs.map(spec=>createHmac('sha256',authSecret).update(JSON.stringify(spec)).digest('hex'));
     await db.authRateLimit.deleteMany({where:{key:{in:keys}}});
     // Only this fixed fixture root's single UUID child is removable.
     assert.equal(path.dirname(userDir),dataRoot);
     await fs.rm(userDir,{recursive:true,force:true});
   } finally {await db.$disconnect();}
 });
