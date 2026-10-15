import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@prisma/client';
import { newTotpSecret, totp, matchingTotpCounter, newRecoveryCodes, recoveryHash } from './totp';
import { encryptApiKey } from '@/lib/security/api-key-crypto';
const { findUnique, updateMany } = vi.hoisted(() => ({findUnique:vi.fn(), updateMany:vi.fn()}));
vi.mock('@/lib/identity-db', () => ({identityDb:{user:{findUnique,updateMany}}}));
import { consumeSecondFactor, currentSessionUser, validPassword } from './identity';
beforeEach(() => {
  vi.clearAllMocks();
  process.env.API_KEY_ENCRYPTION_ACTIVE_KEY_ID='test';
  process.env.API_KEY_ENCRYPTION_KEYS=JSON.stringify({test:Buffer.alloc(32,7).toString('base64')});
});
describe('authenticator and recovery', () => {
  const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  it('matches RFC 6238 SHA1 test vectors truncated to six digits', () => {
    for (const [time, expected] of [[59,'287082'],[1111111109,'081804'],[1111111111,'050471'],[1234567890,'005924'],[2000000000,'279037'],[20000000000,'353130']] as const)
      expect(totp(secret,Math.floor(time/30))).toBe(expected);
    expect(newTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });
  it('rejects a used or out-of-window code', () => {
    expect(matchingTotpCounter(secret,totp(secret,100),99,3000000)).toBe(100);
    expect(matchingTotpCounter(secret,totp(secret,100),100,3000000)).toBeNull();
    expect(matchingTotpCounter(secret,totp(secret,97),-1,3000000)).toBeNull();
  });
  it('consumes a TOTP step only when the atomic update wins', async () => {
    const user={id:'a',sessionVersion:0,mfaSecret:encryptApiKey(secret,{userId:'a',provider:'identity:mfa'}),mfaLastCounter:-1,mfaRecoveryHashes:[]} as unknown as User;
    updateMany.mockResolvedValueOnce({count:1}).mockResolvedValueOnce({count:0});
    const code=totp(secret,Math.floor(Date.now()/30000));
    expect(await consumeSecondFactor({user:{updateMany}} as any,user,code)).toBe(true);
    expect(await consumeSecondFactor({user:{updateMany}} as any,user,code)).toBe(false);
    expect(updateMany.mock.calls[0][0].where.mfaLastCounter.lt).toBeGreaterThan(0);
  });
  it('stores only hashes and removes a recovery code with compare-and-swap', async () => {
    const backup=newRecoveryCodes();
    expect(new Set(backup.codes).size).toBe(10);
    expect(backup.hashes).not.toContain(backup.codes[0]);
    expect(recoveryHash(backup.codes[0].toUpperCase())).toBe(backup.hashes[0]);
    const user={id:'a',sessionVersion:0,mfaSecret:encryptApiKey(secret,{userId:'a',provider:'identity:mfa'}),mfaLastCounter:-1,mfaRecoveryHashes:backup.hashes} as unknown as User;
    updateMany.mockResolvedValueOnce({count:1}).mockResolvedValueOnce({count:0});
    expect(await consumeSecondFactor({user:{updateMany}} as any,user,backup.codes[0])).toBe(true);
    expect(await consumeSecondFactor({user:{updateMany}} as any,user,backup.codes[0])).toBe(false);
    expect(updateMany.mock.calls[0][0].data.mfaRecoveryHashes).toHaveLength(9);
    expect(updateMany.mock.calls[0][0].where.mfaRecoveryHashes.equals).toEqual(backup.hashes);
  });
});
it('rejects old JWTs, revoked versions, deleted and disabled users', async () => {
  expect(await currentSessionUser({id:'a'})).toBeNull();
  expect(findUnique).not.toHaveBeenCalled();
  findUnique.mockResolvedValue({id:'a',sessionVersion:2,disabledAt:null});
  expect(await currentSessionUser({id:'a',sessionVersion:1})).toBeNull();
  expect(await currentSessionUser({id:'a',sessionVersion:2})).toMatchObject({id:'a'});
  findUnique.mockResolvedValue({id:'a',sessionVersion:2,disabledAt:new Date()});
  expect(await currentSessionUser({id:'a',sessionVersion:2})).toBeNull();
  findUnique.mockResolvedValue(null);
  expect(await currentSessionUser({id:'a',sessionVersion:2})).toBeNull();
});
it('enforces bcrypt byte bounds without truncating Unicode passwords', () => {
  expect(validPassword('12345678901')).toBe(false);
  expect(validPassword('x'.repeat(72))).toBe(true);
  expect(validPassword('é'.repeat(37))).toBe(false);
});
