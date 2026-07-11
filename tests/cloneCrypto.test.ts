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
  it('round-trip: decifrar o cifrado devolve os bytes originais', () => {
    const wav = Buffer.from('RIFF....fake wav bytes ção 🎙️', 'utf8');
    const enc = encryptSample(wav, KEY);
    expect(isEncryptedSample(enc)).toBe(true);
    expect(enc.equals(wav)).toBe(false); // ficou mesmo cifrado
    expect(decryptSample(enc, KEY).equals(wav)).toBe(true);
  });

  it('retrocompatível: um .wav ANTIGO em claro passa tal e qual na decifra', () => {
    const legacy = Buffer.from('RIFF plaintext legacy sample');
    expect(isEncryptedSample(legacy)).toBe(false);
    expect(decryptSample(legacy, KEY).equals(legacy)).toBe(true);
  });

  it('deteção de adulteração: alterar o ciphertext faz a decifra lançar (GCM)', () => {
    const enc = encryptSample(Buffer.from('segredo biométrico'), KEY);
    enc[enc.length - 1] ^= 0xff; // corrompe o último byte
    expect(() => decryptSample(enc, KEY)).toThrow();
  });

  it('chave errada não decifra', () => {
    const enc = encryptSample(Buffer.from('abc'), KEY);
    const wrong = deriveCloneKey('outra-passphrase');
    expect(() => decryptSample(enc, wrong)).toThrow();
  });

  it('cada cifra usa um IV novo (dois cifrados do mesmo input diferem)', () => {
    const a = encryptSample(Buffer.from('igual'), KEY);
    const b = encryptSample(Buffer.from('igual'), KEY);
    expect(a.equals(b)).toBe(false);
  });

  it('deriveCloneKey é determinística e dá 32 bytes', () => {
    expect(deriveCloneKey('x').length).toBe(32);
    expect(deriveCloneKey('x').equals(deriveCloneKey('x'))).toBe(true);
  });
});
