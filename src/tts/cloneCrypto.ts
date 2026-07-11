// src/tts/cloneCrypto.ts
//
// Encriptação EM REPOUSO das amostras de voz clonada (.wav) — dado biométrico, o mais
// sensível que o Vozen guarda (ToS de Desenvolvedor do Discord §5(c) + RGPD). AES-256-GCM
// (autenticado: deteta adulteração). A chave deriva de um segredo em `.env` (CLONE_KEY);
// sem chave, a feature fica DESLIGADA (escreve em claro) — retrocompatível com instâncias
// self-hosted que não a definam.
//
// CAVEAT honesto: a chave vive no `.env` na MESMA máquina que os `.wav`. Isto protege
// contra roubo do disco/backup, não contra quem já tem root na máquina.
//
// Formato do ficheiro cifrado: MAGIC(6) | IV(12) | TAG(16) | ciphertext.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const MAGIC = Buffer.from('VZCLE1', 'ascii'); // Vozen CLone Encrypted v1
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER = MAGIC.length + IV_LEN + TAG_LEN;

/** Deriva a chave AES de 256 bits a partir do segredo do .env (determinística). */
export function deriveCloneKey(secret: string): Buffer {
  return scryptSync(secret, 'vozen-clone-v1', 32);
}

/** true se o buffer tem o cabeçalho de cifra do Vozen (senão é um .wav em claro/legado). */
export function isEncryptedSample(buf: Buffer): boolean {
  return buf.length >= MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

/** Cifra os bytes de uma amostra. IV novo por chamada. */
export function encryptSample(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, ct]);
}

/**
 * Decifra os bytes de uma amostra. Se o buffer NÃO estiver cifrado (um .wav antigo em
 * claro), devolve-o inalterado — retrocompatível. Lança se estiver cifrado mas a chave
 * estiver errada ou os bytes tiverem sido adulterados (GCM autentica).
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
