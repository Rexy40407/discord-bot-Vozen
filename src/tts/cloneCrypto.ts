// src/tts/cloneCrypto.ts
//
// Encryption AT REST of cloned voice samples (.wav) — biometric data, the most
// sensitive thing Vozen stores (Discord Developer ToS §5(c) + GDPR). AES-256-GCM
// (authenticated: detects tampering). The key derives from a secret in `.env` (CLONE_KEY);
// without a key, the feature is DISABLED (writes in cleartext) — backwards-compatible with
// self-hosted instances that don't set it.
//
// Honest caveat: the key lives in `.env` on the SAME machine as the `.wav` files. This protects
// against disk/backup theft, not against someone who already has root on the machine.
//
// Encrypted file format: MAGIC(6) | IV(12) | TAG(16) | ciphertext.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const MAGIC = Buffer.from('VZCLE1', 'ascii'); // Vozen CLone Encrypted v1
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER = MAGIC.length + IV_LEN + TAG_LEN;

/** Derives the 256-bit AES key from the .env secret (deterministic). */
export function deriveCloneKey(secret: string): Buffer {
  return scryptSync(secret, 'vozen-clone-v1', 32);
}

/** true if the buffer has Vozen's cipher header (otherwise it's a cleartext/legacy .wav). */
export function isEncryptedSample(buf: Buffer): boolean {
  return buf.length >= MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

/** Encrypts a sample's bytes. New IV per call. */
export function encryptSample(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, ct]);
}

/**
 * Decrypts a sample's bytes. If the buffer is NOT encrypted (an old cleartext .wav),
 * returns it unchanged — backwards-compatible. Throws if it is encrypted but the key
 * is wrong or the bytes have been tampered with (GCM authenticates).
 */
export function decryptSample(buf: Buffer, key: Buffer): Buffer {
  if (!isEncryptedSample(buf)) return buf;
  const iv = buf.subarray(MAGIC.length, MAGIC.length + IV_LEN);
  const tag = buf.subarray(MAGIC.length + IV_LEN, HEADER);
  const ct = buf.subarray(HEADER);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}
