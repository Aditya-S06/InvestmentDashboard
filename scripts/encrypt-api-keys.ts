import { createPrismaClient } from '../lib/database/client';
import { decryptApiKey, encryptApiKey, isEncryptedApiKey } from '../lib/security/api-key-crypto';

const db = createPrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  // Validate key configuration even on an empty database.
  const owner = { userId: 'self-check', provider: 'self-check' };
  if (decryptApiKey(encryptApiKey('self-check', owner), owner) !== 'self-check') throw new Error();
  let cursor: string | undefined;
  let inspected = 0, migrated = 0;
  do {
    const rows = await db.apiKey.findMany({ take: 100, orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!rows.length) break;
    for (const row of rows) {
      const encrypted = isEncryptedApiKey(row.apiKey);
      const plaintext = encrypted ? decryptApiKey(row.apiKey, row) : row.apiKey;
      inspected++;
      if (encrypted && row.apiKey.split(':')[2] === process.env.API_KEY_ENCRYPTION_ACTIVE_KEY_ID) continue;
      const value = encryptApiKey(plaintext, row);
      if (decryptApiKey(value, row) !== plaintext) throw new Error();
      if (apply) {
        const result = await db.apiKey.updateMany({ where: { id: row.id, apiKey: row.apiKey }, data: { apiKey: value } });
        if (result.count !== 1) throw new Error('Concurrent key update; rerun migration');
      }
      migrated++;
    }
    cursor = rows[rows.length - 1].id;
  } while (cursor);
  let mfaSecretsRotated = 0;
  const users = await db.user.findMany({ where: { OR: [{ mfaSecret: { not: null } }, { mfaPendingSecret: { not: null } }] },
    select: { id: true, mfaSecret: true, mfaPendingSecret: true } });
  for (const user of users) {
    const owner = { userId: user.id, provider: 'identity:mfa' };
    for (const field of ['mfaSecret', 'mfaPendingSecret'] as const) {
      const value = user[field];
      if (!value) continue;
      const plaintext = decryptApiKey(value, owner);
      if (value.split(':')[2] === process.env.API_KEY_ENCRYPTION_ACTIVE_KEY_ID) continue;
      if (apply) {
        const changed = await db.user.updateMany({ where: { id: user.id, [field]: value }, data: { [field]: encryptApiKey(plaintext, owner) } });
        if (changed.count !== 1) throw new Error('Concurrent MFA update; rerun migration');
      }
      mfaSecretsRotated++;
    }
  }
  console.log(JSON.stringify({ mode: apply ? 'applied' : 'dry-run', inspected, migrated, mfaSecretsRotated }));
}
main().catch(() => {
  console.error('Key migration failed. No secrets logged. Check encryption configuration and database access; rerun safely.');
  process.exitCode = 1;
}).finally(() => db.$disconnect());
