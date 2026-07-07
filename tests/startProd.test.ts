// tests/startProd.test.ts — política PURA do supervisor de produção (start-prod.mjs).
// Cobre o backoff, a classificação de saída e o loop de pré-aquecimento sem
// processos reais (o start-prod injeta spawn/log).
import { describe, it, expect, vi } from 'vitest';
import {
  backoffDelayMs,
  decideOnExit,
  prewarmNative,
  PREWARM_MAX_TRIES,
} from '../scripts/supervisorPolicy.mjs';

describe('supervisorPolicy — backoff', () => {
  it('sequência: dobra de 2s e limita a 60s', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(backoffDelayMs)).toEqual([
      2000, 4000, 8000, 16000, 32000, 60000, 60000,
    ]);
  });
});

describe('supervisorPolicy — decideOnExit', () => {
  it('código 0 -> stop (o attempt é irrelevante)', () => {
    expect(decideOnExit(0, false, 3)).toEqual({ action: 'stop' });
  });

  it('crash -> restart com delay do attempt ATUAL e nextAttempt+1', () => {
    expect(decideOnExit(1, false, 0)).toEqual({ action: 'restart', delayMs: 2000, nextAttempt: 1 });
    // código null (morto por sinal) também reinicia (espelha o check `=== 0`).
    expect(decideOnExit(null, false, 2)).toEqual({
      action: 'restart',
      delayMs: 8000,
      nextAttempt: 3,
    });
  });

  it('stopping -> ignore (qualquer código)', () => {
    expect(decideOnExit(1, true, 0)).toEqual({ action: 'ignore' });
    expect(decideOnExit(0, true, 0)).toEqual({ action: 'ignore' });
  });
});

describe('supervisorPolicy — prewarmNative', () => {
  it('sucesso a meio: para de tentar e devolve true', () => {
    const logs: string[] = [];
    let calls = 0;
    const tryLoad = vi.fn(() => {
      calls++;
      return calls === 3; // falha 2x, sucesso à 3.ª
    });
    expect(prewarmNative(tryLoad, (m) => logs.push(m))).toBe(true);
    expect(tryLoad).toHaveBeenCalledTimes(3);
    expect(logs[logs.length - 1]).toMatch(/pronta \(tentativa 3\)/);
  });

  it('esgota as tentativas: devolve false e avisa', () => {
    const logs: string[] = [];
    const tryLoad = vi.fn(() => false);
    expect(prewarmNative(tryLoad, (m) => logs.push(m))).toBe(false);
    expect(tryLoad).toHaveBeenCalledTimes(PREWARM_MAX_TRIES);
    expect(logs.some((l) => l.startsWith('AVISO:'))).toBe(true);
  });
});
