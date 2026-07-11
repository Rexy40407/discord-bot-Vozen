// tests/cloneSampleFile.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deriveCloneKey, isEncryptedSample } from '../src/tts/cloneCrypto';
import {
  encryptSampleFileInPlace,
  materializeSampleForSidecar,
  cleanupMaterialized,
} from '../src/tts/cloneSampleFile';

const KEY = deriveCloneKey('teste-cloneSampleFile');
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vozen-csf-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('cloneSampleFile', () => {
  it('cifra o ficheiro no lugar e o sidecar recebe um temp em claro correto', () => {
    const path = join(dir, 'sample.wav');
    const original = Buffer.from('RIFF fake wav biométrico');
    writeFileSync(path, original);

    encryptSampleFileInPlace(path, KEY);
    // Em disco ficou cifrado.
    expect(isEncryptedSample(readFileSync(path))).toBe(true);

    // O sidecar recebe um temp EM CLARO com os bytes originais.
    const ref = materializeSampleForSidecar(path, KEY);
    expect(ref.temp).toBe(true);
    expect(ref.path).not.toBe(path);
    expect(readFileSync(ref.path).equals(original)).toBe(true);

    cleanupMaterialized(ref);
  });

  it('sem chave: cifrar é no-op e o sidecar usa o caminho original', () => {
    const path = join(dir, 'plain.wav');
    const original = Buffer.from('plaintext');
    writeFileSync(path, original);

    encryptSampleFileInPlace(path, undefined);
    expect(readFileSync(path).equals(original)).toBe(true); // inalterado

    const ref = materializeSampleForSidecar(path, undefined);
    expect(ref.temp).toBe(false);
    expect(ref.path).toBe(path);
  });

  it('amostra legada EM CLARO com chave: o sidecar usa o caminho original (sem temp)', () => {
    const path = join(dir, 'legacy.wav');
    writeFileSync(path, Buffer.from('legacy plaintext sample'));
    const ref = materializeSampleForSidecar(path, KEY);
    expect(ref.temp).toBe(false);
    expect(ref.path).toBe(path);
  });

  it('cifrar duas vezes não re-cifra (idempotente)', () => {
    const path = join(dir, 's.wav');
    writeFileSync(path, Buffer.from('abc'));
    encryptSampleFileInPlace(path, KEY);
    const once = readFileSync(path);
    encryptSampleFileInPlace(path, KEY);
    expect(readFileSync(path).equals(once)).toBe(true);
  });
});
