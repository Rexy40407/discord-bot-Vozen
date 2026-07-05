import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { bumpTalk, getTopSpeakers, dateKey, prevDateKey } from '../src/store/talkStats';

const G = 'guild-1';

describe('dateKey / prevDateKey — chaves de dia local', () => {
  it('formata YYYY-MM-DD com zero-padding', () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05'); // 5 jan
    expect(dateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
  it('prevDateKey atravessa fronteiras de mês/ano', () => {
    expect(prevDateKey(new Date(2026, 2, 1))).toBe('2026-02-28'); // 1 mar -> 28 fev (2026 não bissexto)
    expect(prevDateKey(new Date(2026, 0, 1))).toBe('2025-12-31'); // 1 jan -> 31 dez ano anterior
  });
});

describe('bumpTalk — contagem + streak', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

  it('primeira mensagem cria a linha com count 1 e streak 1', () => {
    bumpTalk(db, G, 'u1', d(2026, 7, 5));
    expect(getTopSpeakers(db, G)).toEqual([{ userId: 'u1', count: 1, streak: 1, bestStreak: 1 }]);
  });

  it('várias mensagens no MESMO dia -> count sobe, streak fica 1', () => {
    bumpTalk(db, G, 'u1', d(2026, 7, 5));
    bumpTalk(db, G, 'u1', d(2026, 7, 5));
    bumpTalk(db, G, 'u1', d(2026, 7, 5));
    expect(getTopSpeakers(db, G)[0]).toEqual({ userId: 'u1', count: 3, streak: 1, bestStreak: 1 });
  });

  it('dias SEGUIDOS aumentam o streak', () => {
    bumpTalk(db, G, 'u1', d(2026, 7, 5));
    bumpTalk(db, G, 'u1', d(2026, 7, 6));
    bumpTalk(db, G, 'u1', d(2026, 7, 7));
    expect(getTopSpeakers(db, G)[0]).toEqual({ userId: 'u1', count: 3, streak: 3, bestStreak: 3 });
  });

  it('um INTERVALO reinicia o streak mas mantém o melhor', () => {
    bumpTalk(db, G, 'u1', d(2026, 7, 5));
    bumpTalk(db, G, 'u1', d(2026, 7, 6)); // streak 2
    bumpTalk(db, G, 'u1', d(2026, 7, 9)); // saltou 2 dias -> streak volta a 1
    expect(getTopSpeakers(db, G)[0]).toEqual({ userId: 'u1', count: 3, streak: 1, bestStreak: 2 });
  });

  it('ordena por contagem desc no /topspeakers', () => {
    bumpTalk(db, G, 'u1', d(2026, 7, 5));
    bumpTalk(db, G, 'u2', d(2026, 7, 5));
    bumpTalk(db, G, 'u2', d(2026, 7, 5));
    const top = getTopSpeakers(db, G);
    expect(top.map((r) => r.userId)).toEqual(['u2', 'u1']);
    expect(top[0].count).toBe(2);
  });

  it('é por-guild', () => {
    bumpTalk(db, G, 'u1', d(2026, 7, 5));
    expect(getTopSpeakers(db, 'outra')).toEqual([]);
  });
});
