import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({reauth:vi.fn(),runs:vi.fn(),orders:vi.fn(),disable:vi.fn(),remove:vi.fn(),stat:vi.fn(),deleteUser:vi.fn(),change:vi.fn()}));
vi.mock('@/lib/identity-db',()=>({identityDb:{user:{updateMany:m.change,delete:m.deleteUser}}}));
vi.mock('@/lib/prisma',()=>({prisma:{$transaction:(fn:any)=>fn({deskRun:{count:m.runs},brokerOrder:{count:m.orders},user:{updateMany:m.disable}})}}));
vi.mock('./identity',()=>({reauthenticate:m.reauth,validPassword:(p:unknown)=>typeof p==='string'&&p.length>=12}));
vi.mock('node:fs/promises',()=>({default:{lstat:m.stat,rm:m.remove}}));
import { accountAction, deleteAccount } from './account-service';
import { decryptApiKey } from '@/lib/security/api-key-crypto';
const auth={userId:'fixture-user',email:'fixture@example.test',sessionVersion:3};
beforeEach(()=>{
  vi.clearAllMocks();
  m.reauth.mockResolvedValue({id:auth.userId,email:auth.email,sessionVersion:3,mfaSecret:null});
  m.runs.mockResolvedValue(0);m.orders.mockResolvedValue(0);m.stat.mockResolvedValue(null);
  m.disable.mockResolvedValue({count:1});m.change.mockResolvedValue({count:1});m.remove.mockResolvedValue(undefined);
  process.env.API_KEY_ENCRYPTION_ACTIVE_KEY_ID='test';
  process.env.API_KEY_ENCRYPTION_KEYS=JSON.stringify({test:Buffer.alloc(32,5).toString('base64')});
});
it.each(['runs','orders'] as const)('refuses deletion while %s are active',async(kind)=>{
  m[kind].mockResolvedValue(1);
  await expect(deleteAccount(auth,{password:'a',confirmation:'DELETE'})).rejects.toMatchObject({status:409});
  expect(m.disable).not.toHaveBeenCalled();expect(m.remove).not.toHaveBeenCalled();expect(m.deleteUser).not.toHaveBeenCalled();
});
it('refuses symlink artifact ancestry without disabling the account',async()=>{
  m.stat.mockResolvedValue({isSymbolicLink:()=>true});
  await expect(deleteAccount(auth,{password:'a',confirmation:'DELETE'})).rejects.toMatchObject({status:409});
  expect(m.disable).not.toHaveBeenCalled();expect(m.remove).not.toHaveBeenCalled();
});
it('requires typed confirmation and fresh reauthentication',async()=>{
  await expect(deleteAccount(auth,{password:'a',confirmation:'no'})).rejects.toMatchObject({status:400});
  expect(m.reauth).not.toHaveBeenCalled();
  m.reauth.mockResolvedValue(null);
  await expect(deleteAccount(auth,{password:'a',confirmation:'DELETE'})).rejects.toMatchObject({status:403});
  expect(m.disable).not.toHaveBeenCalled();
});
it('keeps the identity disabled when artifact removal fails',async()=>{
  m.remove.mockRejectedValue(new Error('disk unavailable'));
  await expect(deleteAccount(auth,{password:'a',confirmation:'DELETE'})).rejects.toThrow('disk unavailable');
  expect(m.disable).toHaveBeenCalledWith(expect.objectContaining({data:{disabledAt:expect.any(Date),sessionVersion:{increment:1}}}));
  expect(m.deleteUser).not.toHaveBeenCalled();
});
it('does not remove files if the session changed during deletion',async()=>{
  m.disable.mockResolvedValue({count:0});
  await expect(deleteAccount(auth,{password:'a',confirmation:'DELETE'})).rejects.toMatchObject({status:401});
  expect(m.remove).not.toHaveBeenCalled();
});
it('encrypts a pending secret with account binding and ten-minute expiry',async()=>{
  const start=Date.now();
  const result=await accountAction(auth,{action:'mfa-begin',password:'a'});
  const data=m.change.mock.calls[0][0].data;
  expect(decryptApiKey(data.mfaPendingSecret,{userId:auth.userId,provider:'identity:mfa'})).toBe((result as any).secret);
  expect(data.mfaPendingExpiresAt.getTime()-start).toBeGreaterThanOrEqual(600000);
  expect(data.mfaSecret).toBeUndefined();
});
