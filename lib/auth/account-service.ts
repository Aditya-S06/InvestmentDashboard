import 'server-only';
import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { identityDb } from '@/lib/identity-db';
import { prisma } from '@/lib/prisma';
import { encryptApiKey, decryptApiKey } from '@/lib/security/api-key-crypto';
import { newTotpSecret, matchingTotpCounter, newRecoveryCodes } from './totp';
import { reauthenticate, validPassword } from './identity';
import { deskDataRoot } from '@/lib/desk/config';
import type { SessionUser } from './require-user';

export class AccountError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function accountAction(auth: SessionUser, body: Record<string, unknown>) {
  const user = await reauthenticate(auth.userId, auth.sessionVersion, body.password, body.code ?? '');
  if (!user) throw new AccountError('Password or second-factor code is invalid', 403);
  const where = { id: user.id, sessionVersion: user.sessionVersion, disabledAt: null };
  const owner = { userId: user.id, provider: 'identity:mfa' };
  async function change(data: Parameters<typeof identityDb.user.updateMany>[0]['data']) {
    const result = await identityDb.user.updateMany({ where, data });
    if (result.count !== 1) throw new AccountError('Your session changed. Sign in again.', 401);
  }
  switch (body.action) {
    case 'logout-all':
      await change({ sessionVersion: { increment: 1 } });
      return { signedOut: true };
    case 'password':
      if (!validPassword(body.newPassword)) throw new AccountError('Use at least 12 characters and at most 72 UTF-8 bytes');
      await change({ password: await bcrypt.hash(body.newPassword, 12), sessionVersion: { increment: 1 } });
      return { signedOut: true };
    case 'mfa-begin': {
      if (user.mfaSecret) throw new AccountError('MFA is already enabled');
      const secret = newTotpSecret();
      await change({ mfaPendingSecret: encryptApiKey(secret, owner), mfaPendingExpiresAt: new Date(Date.now() + 10 * 60_000) });
      return { secret, uri: `otpauth://totp/${encodeURIComponent(`Market Intel:${user.email}`)}?secret=${secret}&issuer=Market%20Intel&algorithm=SHA1&digits=6&period=30` };
    }
    case 'mfa-confirm': {
      if (user.mfaSecret || !user.mfaPendingSecret || !user.mfaPendingExpiresAt || user.mfaPendingExpiresAt.getTime() <= Date.now()) {
        throw new AccountError('Enrollment expired. Start again.');
      }
      const counter = matchingTotpCounter(decryptApiKey(user.mfaPendingSecret, owner), String(body.enrollmentCode || ''), -1);
      if (counter === null) throw new AccountError('Invalid authenticator code');
      const recovery = newRecoveryCodes();
      const result = await identityDb.user.updateMany({
        where: { ...where, mfaPendingSecret: user.mfaPendingSecret, mfaSecret: null },
        data: { mfaSecret: user.mfaPendingSecret, mfaPendingSecret: null, mfaPendingExpiresAt: null,
          mfaLastCounter: counter, mfaRecoveryHashes: recovery.hashes, sessionVersion: { increment: 1 } },
      });
      if (result.count !== 1) throw new AccountError('Enrollment changed. Start again.');
      return { recoveryCodes: recovery.codes, signedOut: true };
    }
    case 'mfa-disable':
      await change({ mfaSecret: null, mfaPendingSecret: null, mfaPendingExpiresAt: null, mfaLastCounter: -1,
        mfaRecoveryHashes: [], sessionVersion: { increment: 1 } });
      return { signedOut: true };
    case 'mfa-recovery': {
      if (!user.mfaSecret) throw new AccountError('Enable MFA first');
      const recovery = newRecoveryCodes();
      await change({ mfaRecoveryHashes: recovery.hashes, sessionVersion: { increment: 1 } });
      return { recoveryCodes: recovery.codes, signedOut: true };
    }
    default: throw new AccountError('Unsupported account action');
  }
}

/** Delete only an inactive account. Disable/revoke first, then remove scoped local artifacts and identity. */
export async function deleteAccount(auth: SessionUser, body: Record<string, unknown>) {
  if (body.confirmation !== 'DELETE') throw new AccountError('Type DELETE to confirm');
  const user = await reauthenticate(auth.userId, auth.sessionVersion, body.password, body.code ?? '');
  if (!user) throw new AccountError('Password or second-factor code is invalid', 403);
  const root = path.resolve(deskDataRoot());
  if (!/^[A-Za-z0-9_-]+$/.test(user.id)) throw new AccountError('Account cleanup requires operator assistance', 409);
  const target = path.resolve(root, user.id);
  if (path.dirname(target) !== root) throw new AccountError('Invalid artifact path');
  // Refuse symlinks/junctions anywhere in the ancestry. Never follow an attacker-controlled root.
  for (let current = target; ; current = path.dirname(current)) {
    const stat = await fs.lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat?.isSymbolicLink()) throw new AccountError('Linked artifact directories require operator cleanup', 409);
    if (path.dirname(current) === current) break;
  }
  await prisma.$transaction(async tx => {
    const activeRuns = await tx.deskRun.count({ where: { userId: auth.userId, status: { in: ['queued', 'running'] } } });
    const openOrders = await tx.brokerOrder.count({ where: { userId: auth.userId, status: { notIn: ['FILLED', 'CANCELLED', 'CANCELED', 'REJECTED', 'EXPIRED', 'PREVIEW', 'PREVIEWED'] } } });
    if (activeRuns || openOrders) throw new AccountError('Stop active Desk runs and resolve outstanding broker orders before deleting your account', 409);
    const disabled = await tx.user.updateMany({ where: { id: user.id, sessionVersion: user.sessionVersion, disabledAt: null },
      data: { disabledAt: new Date(), sessionVersion: { increment: 1 } } });
    if (disabled.count !== 1) throw new AccountError('Session changed. Sign in again.', 401);
  });
  // Keep the disabled identity if disk cleanup fails, allowing the operator to retry safely.
  await fs.rm(target, { recursive: true, force: true });
  await identityDb.user.delete({ where: { id: user.id } });
  return { deleted: true };
}
