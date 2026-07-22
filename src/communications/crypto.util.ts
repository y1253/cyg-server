import * as crypto from 'crypto';

// ─── Token encryption (shared by Gmail + Microsoft providers) ────────────────
// AES-256-CBC with a random IV per value, serialized as "ivHex:cipherHex".
// The key is the 32-byte hex ENCRYPTION_KEY (same key used for billing creds in
// companies.service.ts). Both provider services store OAuth tokens encrypted at
// rest and decrypt them just before use.

const ALGORITHM = 'aes-256-cbc';

export function encrypt(text: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(text: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const [ivHex, encHex] = text.split(':');
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivHex, 'hex'),
  );
  return Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}
