// tests/registerState.test.ts — o PUT global de comandos só quando MUDAM (fingerprint).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  commandsFingerprint,
  shouldSkipRegister,
  saveRegisterState,
} from '../src/bot/registerCommands';

describe('commandsFingerprint', () => {
  it('é estável para o mesmo conteúdo e muda quando os defs mudam', () => {
    const a = [{ name: 'tts', options: [{ name: 'text' }] }];
    const b = [{ name: 'tts', options: [{ name: 'text' }, { name: 'novo' }] }];
    expect(commandsFingerprint(a)).toBe(commandsFingerprint(structuredClone(a)));
    expect(commandsFingerprint(a)).not.toBe(commandsFingerprint(b));
    expect(commandsFingerprint(a)).toMatch(/^[0-9a-f]{40}$/); // sha1 hex
  });
});

describe('shouldSkipRegister / saveRegisterState', () => {
  let dir: string;
  let stateFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'register-state-'));
    stateFile = join(dir, 'sub', 'commands-state.json'); // subpasta: testa o mkdir
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('sem estado gravado -> NÃO salta (regista)', () => {
    expect(shouldSkipRegister(stateFile, 'client-1', 'fp-abc')).toBe(false);
  });

  it('estado gravado com o MESMO clientId+fingerprint -> salta', () => {
    saveRegisterState(stateFile, 'client-1', 'fp-abc');
    expect(shouldSkipRegister(stateFile, 'client-1', 'fp-abc')).toBe(true);
  });

  it('fingerprint diferente (comandos mudaram) -> NÃO salta', () => {
    saveRegisterState(stateFile, 'client-1', 'fp-abc');
    expect(shouldSkipRegister(stateFile, 'client-1', 'fp-DIFERENTE')).toBe(false);
  });

  it('clientId diferente (app nova — ex.: migração de conta) -> NÃO salta', () => {
    saveRegisterState(stateFile, 'client-1', 'fp-abc');
    expect(shouldSkipRegister(stateFile, 'client-2', 'fp-abc')).toBe(false);
  });

  it('estado corrompido -> NÃO salta (regista) em vez de rebentar', () => {
    writeFileSync(join(dir, 'corrupto.json'), '{nao é json');
    expect(shouldSkipRegister(join(dir, 'corrupto.json'), 'client-1', 'fp-abc')).toBe(false);
  });
});
