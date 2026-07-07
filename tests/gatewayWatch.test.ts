// tests/gatewayWatch.test.ts — decisão pura do watchdog do gateway.
import { describe, it, expect } from 'vitest';
import { evaluateGateway } from '../src/bot/gatewayWatch';

const MAX = 120_000; // 120s

describe('evaluateGateway', () => {
  it('Ready -> saudável, sem reinício, limpa o unhealthySince', () => {
    const d = evaluateGateway(true, 5000, 10_000, MAX);
    expect(d).toEqual({ healthy: true, unhealthySince: null, downMs: 0, shouldRestart: false });
  });

  it('primeira verificação não-Ready -> ancora o unhealthySince em `now`, ainda não reinicia', () => {
    const d = evaluateGateway(false, null, 10_000, MAX);
    expect(d.healthy).toBe(false);
    expect(d.unhealthySince).toBe(10_000);
    expect(d.downMs).toBe(0);
    expect(d.shouldRestart).toBe(false);
  });

  it('não-Ready DENTRO do limite -> não reinicia', () => {
    const d = evaluateGateway(false, 10_000, 10_000 + 119_000, MAX); // 119s < 120s
    expect(d.shouldRestart).toBe(false);
    expect(d.downMs).toBe(119_000);
    expect(d.unhealthySince).toBe(10_000); // preserva a âncora
  });

  it('não-Ready ALÉM do limite -> reinicia', () => {
    const d = evaluateGateway(false, 10_000, 10_000 + 121_000, MAX); // 121s > 120s
    expect(d.shouldRestart).toBe(true);
    expect(d.downMs).toBe(121_000);
  });

  it('recuperar (Ready depois de não-Ready) limpa o estado -> a próxima queda re-ancora', () => {
    const down = evaluateGateway(false, null, 1000, MAX);
    expect(down.unhealthySince).toBe(1000);
    const up = evaluateGateway(true, down.unhealthySince, 2000, MAX);
    expect(up.unhealthySince).toBeNull();
    // Nova queda mais tarde ancora no NOVO instante (não arrasta o 1000 antigo).
    const down2 = evaluateGateway(false, up.unhealthySince, 500_000, MAX);
    expect(down2.unhealthySince).toBe(500_000);
    expect(down2.shouldRestart).toBe(false);
  });
});
