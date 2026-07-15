// src/tts/cloneSampleFile.ts
//
// FILE layer of clone-sample encryption (the pure crypto lives in
// ./cloneCrypto). Two operations: encrypt the sample on disk when saving, and materialize
// a temporary PLAINTEXT copy for the Python sidecar (which reads the .wav by path and
// cannot decrypt). Without a key, everything is a no-op/pass-through — backward-compatible.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { encryptSample, decryptSample, isEncryptedSample } from './cloneCrypto';

/** Encrypts the sample file in place. No-op without a key or if already encrypted. */
export function encryptSampleFileInPlace(path: string, key: Buffer | undefined): void {
  if (!key) return;
  const buf = readFileSync(path);
  if (isEncryptedSample(buf)) return;
  writeFileSync(path, encryptSample(buf, key));
}

/**
 * Returns a PLAINTEXT file path for the sidecar to read. If the sample is encrypted
 * (and there is a key), decrypts it to a temp and returns `{ path: temp, temp: true }` — the caller
 * deletes the temp with `cleanupMaterialized`. Otherwise (plaintext/legacy sample, or no key)
 * returns the original path `{ path, temp: false }`.
 */
export function materializeSampleForSidecar(
  path: string,
  key: Buffer | undefined,
): { path: string; temp: boolean } {
  if (!key) return { path, temp: false };
  const buf = readFileSync(path);
  if (!isEncryptedSample(buf)) return { path, temp: false };
  const out = join(tmpdir(), `vozen-cref-${randomBytes(8).toString('hex')}.wav`);
  writeFileSync(out, decryptSample(buf, key));
  return { path: out, temp: true };
}

/** Deletes the plaintext temp created by materializeSampleForSidecar (best-effort). */
export function cleanupMaterialized(ref: { path: string; temp: boolean }): void {
  if (!ref.temp) return;
  try {
    rmSync(ref.path, { force: true });
  } catch {
    // best-effort
  }
}
