// tests/cloneCrypto.test.ts
import { describe, it, expect } from 'vitest';
import {
  deriveCloneKey,
  encryptSample,
  decryptSample,
  isEncryptedSample,
} from '../src/tts/cloneCrypto';

const KEY = deriveCloneKey('uma-passphrase-secreta-de-teste');

describe('cloneCrypto', () => {
  it('round-trip: decrypting the ciphertext returns the original bytes', () => {
    const wav = Buffer.from('RIFF....fake wav bytes ção 🎙️', 'utf8');
    const enc = encryptSample(wav, KEY);
    expect(isEncryptedSample(enc)).toBe(true);
    expect(enc.equals(wav)).toBe(false); // it really was encrypted
    expect(decryptSample(enc, KEY).equals(wav)).toBe(true);
  });

  it('backwards-compatible: an OLD plaintext .wav passes through decryption unchanged', () => {
    const legacy = Buffer.from('RIFF plaintext legacy sample');
    expect(isEncryptedSample(legacy)).toBe(false);
    expect(decryptSample(legacy, KEY).equals(legacy)).toBe(true);
  });

  it('tamper detection: altering the ciphertext makes decryption throw (GCM)', () => {
    const enc = encryptSample(Buffer.from('segredo biométrico'), KEY);
    enc[enc.length - 1] ^= 0xff; // corrupts the last byte
    expect(() => decryptSample(enc, KEY)).toThrow();
  });

  it('wrong key does not decrypt', () => {
    const enc = encryptSample(Buffer.from('abc'), KEY);
    const wrong = deriveCloneKey('outra-passphrase');
    expect(() => decryptSample(enc, wrong)).toThrow();
  });

  it('each encryption uses a fresh IV (two ciphertexts of the same input differ)', () => {
    const a = encryptSample(Buffer.from('igual'), KEY);
    const b = encryptSample(Buffer.from('igual'), KEY);
    expect(a.equals(b)).toBe(false);
  });

  it('deriveCloneKey is deterministic and yields 32 bytes', () => {
    expect(deriveCloneKey('x').length).toBe(32);
    expect(deriveCloneKey('x').equals(deriveCloneKey('x'))).toBe(true);
  });
});
