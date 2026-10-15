import 'server-only';
import { prisma } from '@/lib/prisma';
import { decryptApiKey, encryptApiKey } from './api-key-crypto';

export async function readApiKey(userId: string, provider: string): Promise<string | null> {
  const row = await prisma.apiKey.findUnique({ where: { userId_provider: { userId, provider } } });
  return row ? decryptApiKey(row.apiKey, { userId, provider }) : null;
}

export async function saveApiKey(userId: string, provider: string, plaintext: string): Promise<void> {
  const apiKey = encryptApiKey(plaintext, { userId, provider });
  await prisma.apiKey.upsert({
    where: { userId_provider: { userId, provider } },
    create: { userId, provider, apiKey }, update: { apiKey },
  });
}
