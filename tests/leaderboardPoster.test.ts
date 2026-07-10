import { describe, it, expect } from 'vitest';
import {
  LeaderboardPoster,
  renderLeaderboard,
  MIN_MESSAGES,
  COOLDOWN_MS,
} from '../src/leaderboard/randomPost';
import type { TalkRow } from '../src/store/talkStats';

const G = 'guild-1';

// now e rand injetáveis via refs mutáveis (determinismo total).
function makePoster(now: { v: number }, rand: { v: number }): LeaderboardPoster {
  return new LeaderboardPoster(
    () => now.v,
    () => rand.v,
  );
}

describe('LeaderboardPoster.record — limiar + cooldown + sorteio', () => {
  it('acumula em silêncio até MIN_MESSAGES (mesmo com o sorteio a ganhar)', () => {
    const now = { v: 1_000_000_000_000 };
    const rand = { v: 0 }; // 0 < prob -> o sorteio SAI sempre
    const p = makePoster(now, rand);
    // As primeiras MIN_MESSAGES-1 nunca postam (ainda não há atividade suficiente).
    for (let n = 0; n < MIN_MESSAGES - 1; n++) expect(p.record(G)).toBe(false);
    // A MIN_MESSAGES-ésima já é elegível e o sorteio sai -> posta.
    expect(p.record(G)).toBe(true);
  });

  it('o sorteio pode falhar (rand >= prob) — continua a acumular sem postar', () => {
    const now = { v: 1_000_000_000_000 };
    const rand = { v: 0.99 }; // >= prob -> o sorteio nunca sai
    const p = makePoster(now, rand);
    for (let n = 0; n < MIN_MESSAGES + 20; n++) expect(p.record(G)).toBe(false);
    // Assim que o sorteio passar a sair, posta (já é elegível).
    rand.v = 0;
    expect(p.record(G)).toBe(true);
  });

  it('após um post, o COOLDOWN bloqueia novos posts até passar o intervalo', () => {
    const now = { v: 1_000_000_000_000 };
    const rand = { v: 0 };
    const p = makePoster(now, rand);
    for (let n = 0; n < MIN_MESSAGES - 1; n++) p.record(G);
    expect(p.record(G)).toBe(true); // 1.º post (zera o contador, marca o instante)

    // Mesmo com +MIN_MESSAGES mensagens, DENTRO do cooldown não posta.
    for (let n = 0; n < MIN_MESSAGES; n++) expect(p.record(G)).toBe(false);

    // Passado o cooldown, a próxima mensagem elegível volta a postar.
    now.v += COOLDOWN_MS;
    expect(p.record(G)).toBe(true);
  });

  it('é por-guild (guilds independentes)', () => {
    const now = { v: 1_000_000_000_000 };
    const rand = { v: 0 };
    const p = makePoster(now, rand);
    for (let n = 0; n < MIN_MESSAGES; n++) p.record('g-A');
    // g-B começa do zero — não herda o contador de g-A.
    expect(p.record('g-B')).toBe(false);
  });
});

describe('renderLeaderboard — título + linhas (reutiliza topspeakers.line)', () => {
  const rows: TalkRow[] = [
    { userId: 'u1', count: 42, streak: 5, bestStreak: 7 },
    { userId: 'u2', count: 30, streak: 2, bestStreak: 4 },
  ];

  it('inclui o título e uma linha por pessoa com a menção e a contagem', () => {
    const out = renderLeaderboard(rows, 'en');
    expect(out).toContain('Top talkers');
    expect(out).toContain('<@u1>');
    expect(out).toContain('42');
    expect(out).toContain('<@u2>');
    expect(out.split('\n')).toHaveLength(3); // título + 2 linhas
  });

  it('localiza (pt)', () => {
    expect(renderLeaderboard(rows, 'pt')).toContain('Os que mais falam');
  });
});
