// tests/loopLag.test.ts — monitor de bloqueios do event-loop (health/loopLag).
import { describe, it, expect, vi } from 'vitest';
import { createLagTracker, startLoopLagMonitor } from '../src/health/loopLag';
import { metrics } from '../src/metrics';

describe('createLagTracker — cálculo puro do atraso', () => {
  it('tick a horas -> lag 0', () => {
    let now = 1000;
    const tr = createLagTracker(500, () => now);
    now = 1500; // exatamente no instante esperado
    expect(tr.tick()).toBe(0);
    now = 2000;
    expect(tr.tick()).toBe(0);
  });

  it('tick atrasado -> lag = atraso; o tracker re-ancora (não acumula)', () => {
    let now = 1000;
    const tr = createLagTracker(500, () => now);
    now = 2200; // esperado às 1500 -> 700ms de stall
    expect(tr.tick()).toBe(700);
    // Re-ancorado às 2200+500=2700: um tick a horas volta a dar 0 (não arrasta o 700).
    now = 2700;
    expect(tr.tick()).toBe(0);
  });

  it('tick adiantado (drift do timer) -> lag negativo, nunca falso-positivo', () => {
    let now = 1000;
    const tr = createLagTracker(500, () => now);
    now = 1490;
    expect(tr.tick()).toBeLessThan(0);
  });
});

describe('startLoopLagMonitor — wiring (timers reais curtos)', () => {
  it('deteta um bloqueio síncrono e conta em metrics.loopStalls + onStall', async () => {
    metrics.reset();
    const onStall = vi.fn();
    const stop = startLoopLagMonitor({ intervalMs: 20, warnMs: 30, onStall });
    // Bloqueia o event-loop ~80ms (busy-wait síncrono): o tick seguinte chega tarde.
    const t0 = Date.now();
    while (Date.now() - t0 < 80) {
      /* busy-wait deliberado */
    }
    await vi.waitFor(() => expect(onStall).toHaveBeenCalled(), { timeout: 1000 });
    expect(metrics.snapshot().loopStalls).toBeGreaterThanOrEqual(1);
    const lag = onStall.mock.calls[0][0] as number;
    expect(lag).toBeGreaterThanOrEqual(30);
    stop();
    metrics.reset();
  });

  it('sem bloqueios: não dispara (janela curta de ticks saudáveis)', async () => {
    metrics.reset();
    const onStall = vi.fn();
    const stop = startLoopLagMonitor({ intervalMs: 10, warnMs: 200, onStall });
    await new Promise((r) => setTimeout(r, 60)); // ~5 ticks saudáveis
    stop();
    expect(onStall).not.toHaveBeenCalled();
    expect(metrics.snapshot().loopStalls).toBe(0);
    metrics.reset();
  });
});
