import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';
type Owner = { userId: string; provider: string };

function keyring() {
  const active = process.env.API_KEY_ENCRYPTION_ACTIVE_KEY_ID || '';
  const keys: Record<string, Buffer> = {};
  try {
    const input = JSON.parse(process.env.API_KEY_ENCRYPTION_KEYS || '{}');
    for (const [id, value] of Object.entries(input)) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || typeof value !== 'string') throw new Error();
      const key = Buffer.from(value, 'base64');
      if (key.length !== 32 || key.toString('base64') !== value) throw new Error();
      keys[id] = key;
    }
    if (!Object.prototype.hasOwnProperty.call(keys, active)) throw new Error();
  } catch {
    throw new Error('API key encryption is not configured correctly');
  }
  return { active, keys };
}

function aad(owner: Owner, id: string) {
  return Buffer.from(JSON.stringify(['ApiKey', 1, id, owner.userId, owner.provider]));
}

export function isEncryptedApiKey(value: string): boolean { return value.startsWith('enc:'); }

export function encryptApiKey(value: string, owner: Owner): string {
  const { active, keys } = keyring();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keys[active], iv);
  cipher.setAAD(aad(owner, active));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${PREFIX}${active}:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decryptApiKey(value: string, owner: Owner): string {
  const { keys } = keyring();
  try {
    const parts = value.split(':');
    if (!value.startsWith(PREFIX) || parts.length !== 6) throw new Error();
    const [, , id, ivText, tagText, ciphertextText] = parts;
    if (!Object.prototype.hasOwnProperty.call(keys, id)) throw new Error();
    const [iv, tag, ciphertext] = [ivText, tagText, ciphertextText].map(text => {
      const bytes = Buffer.from(text, 'base64url');
      if (bytes.toString('base64url') !== text) throw new Error();
      return bytes;
    });
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', keys[id], iv);
    decipher.setAAD(aad(owner, id));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // Never put ciphertext, key material, owner identifiers, or crypto internals into errors.
    throw new Error('Stored API key cannot be decrypted; migration or key recovery is required');
  }
}
