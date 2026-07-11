import * as nodeCrypto from 'crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // bytes

function getKey(): Buffer {
  const hexKey = process.env.ENCRYPTION_KEY;
  if (!hexKey || hexKey.length !== 64) {
    // In production an ephemeral per-restart key silently orphans every stored
    // provider key on the next restart (rule #5). Fail loud instead of degrading.
    if (config.isProd) {
      throw new Error(
        '[CRYPTO] ENCRYPTION_KEY missing or wrong length (need 64 hex chars) — refusing to start in production. ' +
          'Set ENCRYPTION_KEY in .env before deploying.',
      );
    }
    console.warn('[CRYPTO] ENCRYPTION_KEY missing or wrong length — using ephemeral key (dev only)');
    return nodeCrypto.randomBytes(KEY_LENGTH);
  }
  return Buffer.from(hexKey, 'hex');
}

/* Startup fail-fast: in production, refuse to boot without a valid
   ENCRYPTION_KEY rather than lazily throwing on the first provider-key op.
   No-op in dev/test (ephemeral key path stays available with a warning). */
export function assertEncryptionKey(): void {
  if (!config.isProd) return;
  getKey(); // throws in production when the key is missing/malformed
}

// Returns "hex(iv):hex(authTag):hex(ciphertext)"
export function encryptText(plaintext: string): string {
  const key = getKey();
  const iv = nodeCrypto.randomBytes(12);
  const cipher = nodeCrypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptText(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid ciphertext format');
  const [ivHex, authTagHex, dataHex] = parts;
  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const decipher = nodeCrypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
