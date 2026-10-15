import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newTotpSecret(): string {
  let bits = 0, value = 0, output = '';
  for (const byte of randomBytes(20)) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return output;
}
function decodeBase32(input: string): Buffer {
  if (!/^[A-Z2-7]+$/.test(input)) throw new Error('Invalid authenticator secret');
  let bits = 0, value = 0; const bytes: number[] = [];
  for (const char of input) {
    value = (value << 5) | alphabet.indexOf(char); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}
/** RFC 4226/6238: SHA-1, six digits, 30-second steps; test against published vectors. */
export function totp(secret: string, counter: number): string {
  const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
export function matchingTotpCounter(secret: string, code: string, lastCounter: number, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30000);
  for (const counter of [current, current - 1, current + 1]) {
    if (counter < 0 || counter <= lastCounter) continue;
    if (timingSafeEqual(Buffer.from(totp(secret, counter)), Buffer.from(code))) return counter;
  }
  return null;
}
export function recoveryHash(code: string): string {
  return createHash('sha256').update(code.trim().replace(/-/g, '').toLowerCase()).digest('hex');
}
export function newRecoveryCodes() {
  const codes = Array.from({ length: 10 }, () => randomBytes(16).toString('hex').match(/.{4}/g)!.join('-'));
  return { codes, hashes: codes.map(recoveryHash) };
}
