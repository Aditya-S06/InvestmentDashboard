import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/require-user';
import { isInsightsAdmin } from '@/lib/auth/admin';
import { prisma } from '@/lib/prisma';
import { saveApiKey } from './api-key-store';
import { withMutationProtection } from './mutation';

const PROVIDERS = new Set(['alpha_vantage', 'polygon', 'openrouter']);

export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  try {
    const admin = isInsightsAdmin(auth.email);
    const keys = await prisma.apiKey.findMany({
      where: { userId: auth.userId, ...(admin ? { provider: { not: 'openrouter' } } : {}) },
      select: { provider: true, updatedAt: true },
    });
    return NextResponse.json(keys.map(key => ({ provider: key.provider, hasKey: true, updatedAt: key.updatedAt.toISOString() })));
  } catch {
    console.error('[apikeys/read] Could not read key metadata');
    return NextResponse.json({ error: 'Could not load API key settings' }, { status: 500 });
  }
}

export const POST = withMutationProtection(async (request: NextRequest) => {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const { provider, apiKey } = body ?? {};
    if (typeof provider !== 'string' || !PROVIDERS.has(provider)) {
      return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
    }
    if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 8192) {
      return NextResponse.json({ error: 'A valid API key is required' }, { status: 400 });
    }
    if (provider === 'openrouter' && isInsightsAdmin(auth.email)) {
      return NextResponse.json({ error: 'Admin account uses the server OpenRouter key' }, { status: 403 });
    }
    await saveApiKey(auth.userId, provider, apiKey.trim());
    return NextResponse.json({ success: true });
  } catch {
    // Prisma errors can contain query arguments. Do not log secrets or request bodies.
    console.error('[apikeys/write] Could not store encrypted key');
    return NextResponse.json({ error: 'Could not save API key' }, { status: 500 });
  }
});
