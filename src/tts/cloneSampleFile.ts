// src/tts/cloneSampleFile.ts
//
// Camada de FICHEIRO da encriptação de amostras de clone (a cripto pura vive em
// ./cloneCrypto). Duas operações: cifrar a amostra em disco ao gravar, e materializar
// uma cópia EM CLARO temporária para o sidecar Python (que lê o .wav por caminho e não
// sabe decifrar). Sem chave, tudo é no-op/pass-through — retrocompatível.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { encryptSample, decryptSample, isEncryptedSample } from './cloneCrypto';

/** Cifra o ficheiro de amostra no lugar. No-op sem chave ou se já estiver cifrado. */
export function encryptSampleFileInPlace(path: string, key: Buffer | undefined): void {
  if (!key) return;
  const buf = readFileSync(path);
  if (isEncryptedSample(buf)) return;
  writeFileSync(path, encryptSample(buf, key));
}

/**
 * Devolve um caminho de ficheiro EM CLARO para o sidecar ler. Se a amostra estiver cifrada
 * (e houver chave), decifra para um temp e devolve `{ path: temp, temp: true }` — o chamador
 * apaga o temp com `cleanupMaterialized`. Senão (amostra em claro/legado, ou sem chave)
 * devolve o caminho original `{ path, temp: false }`.
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

/** Apaga o temp em claro criado por materializeSampleForSidecar (best-effort). */
export function cleanupMaterialized(ref: { path: string; temp: boolean }): void {
  if (!ref.temp) return;
  try {
    rmSync(ref.path, { force: true });
  } catch {
    // best-effort
  }
}
