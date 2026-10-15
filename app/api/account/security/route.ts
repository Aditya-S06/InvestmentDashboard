export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/require-user';
import { identityDb } from '@/lib/identity-db';
import { consumeRateLimit } from '@/lib/auth/rate-limit';
import { accountAction, deleteAccount, AccountError } from '@/lib/auth/account-service';
import { withMutationProtection } from '@/lib/security/mutation';

export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const user = await identityDb.user.findUnique({ where: { id: auth.userId }, select: { mfaSecret: true, mfaRecoveryHashes: true } });
  return NextResponse.json({ mfaEnabled: !!user?.mfaSecret, recoveryCodesRemaining: user?.mfaRecoveryHashes.length ?? 0 },
    { headers: { 'Cache-Control': 'no-store' } });
}

async function mutate(request: Request, remove: boolean) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  try {
    const limited = await consumeRateLimit(`account-security:${auth.userId}`, 10, 15 * 60_000);
    if (!limited.allowed) return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
    const text = await request.text();
    if (text.length > 8192) return NextResponse.json({ error: 'Request too large' }, { status: 413 });
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AccountError('Invalid request');
    const result = remove ? await deleteAccount(auth, body) : await accountAction(auth, body);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof AccountError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[account-security] Operation failed; inspect account state before retrying deletion');
    return NextResponse.json({ error: 'Account operation failed. Contact the operator if deletion was in progress.' }, { status: 503 });
  }
}
export const POST = withMutationProtection((request: Request) => mutate(request, false));
export const DELETE = withMutationProtection((request: Request) => mutate(request, true));
