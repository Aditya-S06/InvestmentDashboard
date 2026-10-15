import 'server-only';
import bcrypt from 'bcryptjs';
import type { Prisma, User } from '@prisma/client';
import { identityDb } from '@/lib/identity-db';
import { decryptApiKey } from '@/lib/security/api-key-crypto';
import { matchingTotpCounter, recoveryHash } from './totp';

type IdentityClient = Pick<Prisma.TransactionClient, 'user'>;
export function validPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length >= 12 && Buffer.byteLength(password, 'utf8') <= 72;
}

/** Atomic CAS consumes a TOTP step or recovery code once, including concurrent requests. */
export async function consumeSecondFactor(db: IdentityClient, user: User, code: string): Promise<boolean> {
  if (!user.mfaSecret) return true;
  const secret = decryptApiKey(user.mfaSecret, { userId: user.id, provider: 'identity:mfa' });
  const counter = matchingTotpCounter(secret, code.trim(), user.mfaLastCounter);
  if (counter !== null) {
    const result = await db.user.updateMany({
      where: { id: user.id, sessionVersion: user.sessionVersion, disabledAt: null, mfaSecret: user.mfaSecret, mfaLastCounter: { lt: counter } },
      data: { mfaLastCounter: counter },
    });
    return result.count === 1;
  }
  const hash = recoveryHash(code);
  if (!user.mfaRecoveryHashes.includes(hash)) return false;
  const result = await db.user.updateMany({
    where: { id: user.id, sessionVersion: user.sessionVersion, disabledAt: null, mfaRecoveryHashes: { equals: user.mfaRecoveryHashes } },
    data: { mfaRecoveryHashes: user.mfaRecoveryHashes.filter(value => value !== hash) },
  });
  return result.count === 1;
}

export async function reauthenticate(userId: string, version: number, password: unknown, code: unknown): Promise<User | null> {
  if (typeof password !== 'string' || typeof code !== 'string') return null;
  const user = await identityDb.user.findUnique({ where: { id: userId } });
  if (!user?.password || user.disabledAt || user.sessionVersion !== version) return null;
  if (!await bcrypt.compare(password, user.password)) return null;
  if (!await consumeSecondFactor(identityDb, user, code)) return null;
  return user;
}

export async function currentSessionUser(token: { id?: unknown; sessionVersion?: unknown }) {
  if (typeof token.id !== 'string' || !Number.isInteger(token.sessionVersion)) return null;
  const user = await identityDb.user.findUnique({ where: { id: token.id }, select: {
    id: true, email: true, name: true, sessionVersion: true, disabledAt: true,
  } });
  return user && !user.disabledAt && user.sessionVersion === token.sessionVersion ? user : null;
}
