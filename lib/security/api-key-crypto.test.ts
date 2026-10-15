import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptApiKey, encryptApiKey } from './api-key-crypto';

const owner = { userId: 'user-one', provider: 'openrouter' };
beforeEach(() => {
  vi.stubEnv('API_KEY_ENCRYPTION_ACTIVE_KEY_ID', 'primary');
  vi.stubEnv('API_KEY_ENCRYPTION_KEYS', JSON.stringify({ primary: Buffer.alloc(32, 1).toString('base64') }));
});
afterEach(() => vi.unstubAllEnvs());

describe('API key encryption', () => {
  it('round trips with a fresh nonce and no plaintext in the envelope', () => {
    const first = encryptApiKey('secret-api-value', owner);
    expect(first).not.toContain('secret-api-value');
    expect(encryptApiKey('secret-api-value', owner)).not.toBe(first);
    expect(decryptApiKey(first, owner)).toBe('secret-api-value');
  });
  it('rejects copying between users/providers and ciphertext tampering', () => {
    const value = encryptApiKey('secret', owner);
    expect(() => decryptApiKey(value, { ...owner, userId: 'other' })).toThrow();
    expect(() => decryptApiKey(value, { ...owner, provider: 'polygon' })).toThrow();
    const parts = value.split(':');
    parts[5] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptApiKey(parts.join(':'), owner)).toThrow();
  });
  it('rejects plaintext and missing/wrong keys without a fallback', () => {
    const value = encryptApiKey('secret', owner);
    expect(() => decryptApiKey('legacy-plaintext', owner)).toThrow();
    vi.stubEnv('API_KEY_ENCRYPTION_KEYS', JSON.stringify({ primary: Buffer.alloc(32, 2).toString('base64') }));
    expect(() => decryptApiKey(value, owner)).toThrow();
    vi.stubEnv('API_KEY_ENCRYPTION_KEYS', '{}');
    expect(() => encryptApiKey('secret', owner)).toThrow();
  });
  it('supports rotation while retaining the old decryption key', () => {
    const old = encryptApiKey('secret', owner);
    vi.stubEnv('API_KEY_ENCRYPTION_KEYS', JSON.stringify({ primary: Buffer.alloc(32, 1).toString('base64'), next: Buffer.alloc(32, 2).toString('base64') }));
    vi.stubEnv('API_KEY_ENCRYPTION_ACTIVE_KEY_ID', 'next');
    expect(decryptApiKey(old, owner)).toBe('secret');
    expect(encryptApiKey('secret', owner)).toMatch(/^enc:v1:next:/);
  });
});
