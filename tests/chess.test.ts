import { describe, it, expect, vi } from 'vitest';
import { GameManager } from '../src/games/manager';
import type { Clock, GameEnv, TimerHandle } from '../src/games/types';
import { gameById } from '../src/games/index';

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

class FakeClock implements Clock {
  time = 0;
  private timers: { id: number; at: number; fn: () => void }[] = [];
  private seq = 1;
  now(): number {
    return this.time;
  }
  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.seq++;
    this.timers.push({ id, at: this.time + ms, fn });
    return id;
  }
  clearTimeout(handle: TimerHandle): void {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t.id !== due.id);
      this.time = due.at;
      due.fn();
    }
    this.time = target;
  }
}

const G = 'g1';
const C = 'c1';
function harness() {
  const clock = new FakeClock();
  const send = vi.fn(async () => {});
  const persistScores = vi.fn();
  const env: GameEnv = {
    clock,
    availableModels: ['en_US-amy-medium'],
    defaultSpeed: 1,
    defaultVoiceOf: () => 'en_US-amy-medium',
    getPlayer: () => undefined, // chess não usa voz
    sendToChannel: send,
    localeOf: () => 'en',
    translate: (key) => key, // devolve a própria chave -> asserções por chave
    persistScores,
    logError: vi.fn(),
    // sem boardEmojis -> ctx.emoji devolve undefined -> render ASCII
  };
  return { env, clock, send, persistScores };
}
const msg = (authorId: string, content: string) => ({
  guildId: G,
  channelId: C,
  authorId,
  authorName: authorId.toUpperCase(),
  content,
});
const sentKeys = (send: ReturnType<typeof vi.fn>): string[] =>
  send.mock.calls.map((c) => String(c[1]).split(' ')[0]);

describe('chess — resign', () => {
  it('resign como PRIMEIRA interação não seata nem termina o jogo em silêncio', async () => {
    const { env, send } = harness();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('chess')!.create(), false, 'en');
    await flush();
    mgr.handleMessage(msg('u1', 'resign')); // primeira interação = resign, sem oponente
    await flush();
    // Não deve conceder a ninguém nem terminar em silêncio: o jogo continua ativo.
    expect(mgr.active(G)).toBe(true);
    expect(sentKeys(send)).not.toContain('game.chess.resigned');
  });

  it('resign de um jogador SENTADO concede ao oponente e termina', async () => {
    const { env, send, persistScores } = harness();
    const mgr = new GameManager(env);
    mgr.start(G, C, gameById('chess')!.create(), false, 'en');
    await flush();
    mgr.handleMessage(msg('u1', 'e4')); // u1 = brancas
    await flush();
    mgr.handleMessage(msg('u2', 'e5')); // u2 = pretas
    await flush();
    mgr.handleMessage(msg('u1', 'resign')); // brancas desistem
    await flush();
    expect(sentKeys(send)).toContain('game.chess.resigned');
    expect(mgr.active(G)).toBe(false);
    const pts = persistScores.mock.calls.at(-1)?.[1] as Map<string, number>;
    expect(pts.get('u2') ?? 0).toBe(3); // oponente (pretas) ganhou
  });
});
