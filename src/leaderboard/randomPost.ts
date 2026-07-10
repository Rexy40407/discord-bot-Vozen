// src/leaderboard/randomPost.ts — leaderboard automático que "aparece de vez em quando".
//
// De tempos a tempos, o Vozen posta o top de tagarelas (o mesmo do /topspeakers) no canal
// do /setup. É ativado por ATIVIDADE (mensagens lidas), NÃO por um timer — assim nunca
// posta em canais mortos e os testes são determinísticos (relógio + aleatoriedade
// injetáveis). Estado em memória por-guild (reset no restart é aceitável; o limiar de
// mensagens evita um re-post logo a seguir a um deploy). Cap + evict, como o GreetCooldown.

import type { TalkRow } from '../store/talkStats';
import { t } from '../i18n/index';

/** Mensagens lidas mínimas (acumuladas desde o último post) antes de poder aparecer. */
export const MIN_MESSAGES = 30;
/** Intervalo mínimo entre posts na mesma guild. */
export const COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12h
/** Probabilidade de aparecer numa mensagem JÁ elegível — dá o efeito "aleatório". */
export const POST_PROBABILITY = 0.15;
/** Teto de guilds em memória (anti-crescimento); evict da mais antiga ao exceder. */
const MAX_ENTRIES = 10_000;

interface GuildState {
  count: number;
  lastPostAt: number;
}

/**
 * Decisor do leaderboard automático por-guild. Relógio (`now`) e aleatoriedade (`rand`,
 * 0..1) injetáveis para testes. Uma instância partilhada vive no BotDeps (como o
 * GreetCooldown / lastSpeaker).
 */
export class LeaderboardPoster {
  // Map preserva ordem de inserção → a 1.ª chave é a mais antiga (evict simples).
  private readonly state = new Map<string, GuildState>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly rand: () => number = Math.random,
  ) {}

  /**
   * Regista uma mensagem lida na guild e decide se o leaderboard deve aparecer AGORA:
   * true quando já houve ≥ MIN_MESSAGES desde o último post, passou o COOLDOWN, e um
   * sorteio (POST_PROBABILITY) sai — e nesse caso ZERA o contador e marca o instante.
   * False caso contrário (continua a acumular). Chamar só quando a mensagem foi MESMO
   * lida (senão contaria mensagens não faladas).
   */
  record(guildId: string): boolean {
    const s = this.state.get(guildId) ?? { count: 0, lastPostAt: 0 };
    s.count++;
    // reinsere no fim (MRU) para o evict acertar na guild mais antiga
    this.state.delete(guildId);
    this.state.set(guildId, s);
    if (this.state.size > MAX_ENTRIES) {
      const oldest = this.state.keys().next().value as string | undefined;
      if (oldest !== undefined) this.state.delete(oldest);
    }
    if (s.count < MIN_MESSAGES) return false;
    if (this.now() - s.lastPostAt < COOLDOWN_MS) return false;
    if (this.rand() >= POST_PROBABILITY) return false; // desta vez não — continua a acumular
    s.count = 0;
    s.lastPostAt = this.now();
    return true;
  }
}

/**
 * Renderiza o leaderboard automático (título + top linhas) para enviar no canal. PURO.
 * Reutiliza a MESMA linha do /topspeakers (topspeakers.line). O chamador envia com as
 * menções SUPRIMIDAS (allowedMentions vazio) — é um post não-solicitado, não deve pingar.
 */
export function renderLeaderboard(rows: TalkRow[], locale: string): string {
  const title = t('leaderboard.autoTitle', locale);
  const lines = rows.map((r, idx) =>
    t('topspeakers.line', locale, {
      rank: idx + 1,
      user: r.userId,
      count: r.count,
      streak: r.streak,
    }),
  );
  return `${title}\n${lines.join('\n')}`;
}
