import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { purgeCloneDerivedAudio, CLONE_DERIVED_NAMESPACES } from '../src/tts/cache';

describe('purgeCloneDerivedAudio — apagamento de áudio de voz clonada (RGPD)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vozen-cache-'));
    for (const ns of ['clone', 'fx', 'q', 'piper']) {
      mkdirSync(join(root, ns), { recursive: true });
      writeFileSync(join(root, ns, 'a.wav'), 'x');
    }
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('cobre clone E fx (o EffectEngine envolve o CloneEngine)', () => {
    expect([...CLONE_DERIVED_NAMESPACES].sort()).toEqual(['clone', 'fx']);
  });

  it('purga os namespaces derivados do clone e preserva os outros', () => {
    purgeCloneDerivedAudio(root);
    expect(existsSync(join(root, 'clone'))).toBe(false);
    expect(existsSync(join(root, 'fx'))).toBe(false);
    expect(existsSync(join(root, 'q'))).toBe(true); // prosódia: não guarda clone (24k -> base uncached)
    expect(existsSync(join(root, 'piper'))).toBe(true); // motor normal: intocado
  });

  it('não lança se a raiz da cache não existir', () => {
    expect(() => purgeCloneDerivedAudio(join(root, 'nope'))).not.toThrow();
  });
});
