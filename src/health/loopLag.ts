// src/health/loopLag.ts
//
// Monitor de BLOQUEIOS do event-loop. Um tick de setInterval que chega atrasado
// significa que algo segurou o loop (I/O síncrono grande, CPU saturada da máquina,
// GC longo). Isso atrasa TODAS as respostas do bot — em especial o AUTOCOMPLETE,
// que tem ~3s de orçamento total e não pode ser deferido ("Falha ao carregar
// opções" no cliente). Este monitor transforma esses episódios invisíveis em
// linhas de log + contador (metrics.loopStalls), para o diagnóstico deixar de
// ser adivinhação.
//
// O cálculo do atraso vive num tracker puro (createLagTracker) para ser testável
// sem timers reais.

import { log } from '../logging/logger';
import { metrics } from '../metrics';

export interface LagTracker {
  /** Chamado a cada tick; devolve o atraso (ms) face ao instante esperado. */
  tick(): number;
}

/** Tracker puro: `expected` re-ancora em cada tick para não acumular deriva. */
export function createLagTracker(intervalMs: number, now: () => number): LagTracker {
  let expected = now() + intervalMs;
  return {
    tick(): number {
      const t = now();
      const lag = t - expected;
      expected = t + intervalMs;
      return lag;
    },
  };
}

export interface LoopLagOptions {
  /** Cadência do tick (default 500ms — granular o suficiente p/ stalls de 400ms). */
  intervalMs?: number;
  /** Atraso a partir do qual conta como stall (default 400ms). */
  warnMs?: number;
  /** Hook de teste/extensão; chamado com o atraso medido. */
  onStall?: (lagMs: number) => void;
}

/** Arranca o monitor; devolve uma função de paragem. O timer é unref'd. */
export function startLoopLagMonitor(opts: LoopLagOptions = {}): () => void {
  const intervalMs = opts.intervalMs ?? 500;
  const warnMs = opts.warnMs ?? 400;
  const tracker = createLagTracker(intervalMs, Date.now);
  const timer = setInterval(() => {
    const lag = tracker.tick();
    if (lag >= warnMs) {
      metrics.inc('loopStalls');
      log.warn(
        `[loop] event-loop esteve bloqueado ~${Math.round(lag)}ms — respostas (autocomplete incluído) atrasaram este intervalo.`,
      );
      opts.onStall?.(lag);
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
