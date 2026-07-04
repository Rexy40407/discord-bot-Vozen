import { describe, it, expect, vi, afterEach } from 'vitest';
import { AloneWatcher, ALONE_LEAVE_MS } from '../src/voice/aloneWatcher';

const G = 'guild-1';
const MS = 1000;

// Helper: watcher com contagem de humanos MUTÁVEL e `leave` espiado. Usa os timers
// globais (fake via vi.useFakeTimers), como em produção.
function makeWatcher() {
  const leave = vi.fn();
  const state = { humans: 0 as number | null };
  const watcher = new AloneWatcher({
    leaveMs: MS,
    humansInBotChannel: () => state.humans,
    leave,
  });
  return { watcher, leave, state };
}

describe('AloneWatcher — sai só quando sozinho por leaveMs', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('default é 0 (saída IMEDIATA quando fica sozinho)', () => {
    expect(ALONE_LEAVE_MS).toBe(0);
  });

  it('leaveMs<=0 (default) -> sai JÁ, síncrono, sem armar timer', () => {
    const leave = vi.fn();
    const state = { humans: 0 as number | null };
    // Sem leaveMs -> usa o default (ALONE_LEAVE_MS = 0 = imediato).
    const watcher = new AloneWatcher({ humansInBotChannel: () => state.humans, leave });
    watcher.evaluate(G);
    // Saiu imediatamente (não há timer pendente e leave foi chamado já).
    expect(leave).toHaveBeenCalledTimes(1);
    expect(leave).toHaveBeenCalledWith(G);
    expect(watcher.pendingCount()).toBe(0);
  });

  it('com humanos presentes NUNCA sai (fica para sempre, sem inatividade)', () => {
    const leave = vi.fn();
    const state = { humans: 3 as number | null };
    const watcher = new AloneWatcher({ humansInBotChannel: () => state.humans, leave });
    // Várias reavaliações (mutes/deafens/etc.) com gente na call -> nunca sai.
    watcher.evaluate(G);
    watcher.evaluate(G);
    watcher.evaluate(G);
    expect(leave).not.toHaveBeenCalled();
    expect(watcher.pendingCount()).toBe(0);
  });

  it('sozinho (0 humanos) -> após leaveMs sai (leave 1x)', () => {
    vi.useFakeTimers();
    const { watcher, leave, state } = makeWatcher();
    state.humans = 0;
    watcher.evaluate(G);
    expect(watcher.pendingCount()).toBe(1);
    expect(leave).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MS * 2);
    expect(leave).toHaveBeenCalledTimes(1);
    expect(leave).toHaveBeenCalledWith(G);
    expect(watcher.pendingCount()).toBe(0);
  });

  it('alguém entra ANTES do timer -> evaluate cancela, não sai', () => {
    vi.useFakeTimers();
    const { watcher, leave, state } = makeWatcher();
    state.humans = 0;
    watcher.evaluate(G); // arma
    state.humans = 1;
    watcher.evaluate(G); // entra alguém -> cancela
    expect(watcher.pendingCount()).toBe(0);
    vi.advanceTimersByTime(MS * 3);
    expect(leave).not.toHaveBeenCalled();
  });

  it('RE-VERIFICA no disparo: se entrou alguém no último instante, NÃO sai', () => {
    vi.useFakeTimers();
    const { watcher, leave, state } = makeWatcher();
    state.humans = 0;
    watcher.evaluate(G); // arma com 0
    // Alguém entra mas a VoiceStateUpdate ainda não correu (evaluate não chamado).
    state.humans = 1;
    vi.advanceTimersByTime(MS * 2); // dispara -> re-check vê 1 -> não sai
    expect(leave).not.toHaveBeenCalled();
  });

  it('bot já não está em voz (null) -> cancela o timer', () => {
    vi.useFakeTimers();
    const { watcher, leave, state } = makeWatcher();
    state.humans = 0;
    watcher.evaluate(G);
    state.humans = null;
    watcher.evaluate(G);
    expect(watcher.pendingCount()).toBe(0);
    vi.advanceTimersByTime(MS * 2);
    expect(leave).not.toHaveBeenCalled();
  });

  it('re-avaliar enquanto já conta NÃO estica a janela (não re-arma)', () => {
    vi.useFakeTimers();
    const { watcher, leave, state } = makeWatcher();
    state.humans = 0;
    watcher.evaluate(G); // arma em t=0
    vi.advanceTimersByTime(MS * 0.6);
    watcher.evaluate(G); // continua sozinho -> NÃO re-arma
    expect(watcher.pendingCount()).toBe(1);
    vi.advanceTimersByTime(MS * 0.5); // total 1.1*MS -> passou dos MS originais
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('clear() cancela — o funil removePlayer garante que o timer não sobrevive', () => {
    vi.useFakeTimers();
    const { watcher, leave, state } = makeWatcher();
    state.humans = 0;
    watcher.evaluate(G);
    watcher.clear(G); // como removePlayer faz
    expect(watcher.pendingCount()).toBe(0);
    vi.advanceTimersByTime(MS * 2);
    expect(leave).not.toHaveBeenCalled();
  });
});
