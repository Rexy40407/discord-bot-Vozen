import { LOCALE_DISPLAY_NAMES } from '../i18n/index';
import type { Game, GameContext, GameDefinition, GameMessage } from './types';
import { LANGUAGE_PHRASES } from './content/languagePhrases';
import { baseCodeOf, localizedLanguageName, normalizeAnswer, seededShuffle } from './util';

/** Rondas por partida e tempo-limite de cada ronda. */
const ROUNDS = 5;
const ROUND_MS = 25_000;

interface Candidate {
  base: string;
  model: string;
  phrase: string;
}

/**
 * Linguas jogaveis: as que tem AO MESMO TEMPO uma voz instalada E uma frase. Uma
 * entrada por base (a 1a voz encontrada para essa lingua), preservando a ordem de
 * availableModels. PURA.
 */
export function guessableLanguages(availableModels: string[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const model of availableModels) {
    const base = baseCodeOf(model);
    if (seen.has(base)) continue;
    const phrase = LANGUAGE_PHRASES[base];
    if (!phrase) continue;
    seen.add(base);
    out.push({ base, model, phrase });
  }
  return out;
}

/**
 * Conjunto de respostas ACEITES para a lingua `base`, no `locale` da guild: o codigo
 * base ('de'), o autonimo ('Deutsch'), o nome no locale do servidor ('Alemão' num
 * servidor PT) e o nome em ingles ('German'). Tudo normalizado (sem acentos, minusc.)
 * para comparacao tolerante. PURA.
 */
export function acceptableAnswers(base: string, locale: string): Set<string> {
  const set = new Set<string>();
  const add = (s: string | undefined): void => {
    if (s) set.add(normalizeAnswer(s));
  };
  add(base);
  add((LOCALE_DISPLAY_NAMES as Record<string, string>)[base]); // autonimo, se suportado
  add(localizedLanguageName(base, locale)); // nome no locale da guild
  add(localizedLanguageName(base, 'en')); // nome em ingles
  add(localizedLanguageName(base, base)); // autonimo via ICU (cobre bases nao-suportadas)
  return set;
}

/**
 * "Adivinha a Lingua" — o Voxi le uma frase numa lingua aleatoria (das que tem voz
 * instalada) e o 1o a escrever o nome da lingua ganha o ponto. Best-of-5 rondas.
 *
 * Cada ronda captura o seu numero (`round`) no timeout: um palpite certo avanca a
 * ronda (incrementa `round`), pelo que o timeout velho — que compara `this.round ===
 * myRound` — vira no-op. E o mecanismo que evita o timer-fantasma de uma ronda ja
 * respondida disparar durante a ronda seguinte (sem precisar de cancelar o timer).
 */
class GuessLanguageGame implements Game {
  readonly id = 'guess-language';
  private order: Candidate[] = [];
  private round = 0;
  private answered = true; // true entre rondas (nao aceita palpites fora de ronda)
  private current: Candidate | null = null;
  private answers = new Set<string>();
  /** Placar local so para o resumo final (o ctx.award e a fonte de verdade dos pontos). */
  private readonly tally = new Map<string, { name: string; points: number }>();

  async start(ctx: GameContext): Promise<void> {
    this.order = seededShuffle(guessableLanguages(ctx.availableModels), ctx.seed);
    if (this.order.length === 0) {
      await ctx.send(ctx.t('game.guessLanguage.noLanguages'));
      ctx.end();
      return;
    }
    await ctx.send(ctx.t('game.guessLanguage.intro', { rounds: Math.min(ROUNDS, this.order.length) }));
    this.nextRound(ctx);
  }

  private nextRound(ctx: GameContext): void {
    const total = Math.min(ROUNDS, this.order.length);
    if (this.round >= total) {
      void this.finish(ctx);
      return;
    }
    const cand = this.order[this.round];
    this.round++;
    this.current = cand;
    this.answers = acceptableAnswers(cand.base, ctx.locale);
    this.answered = false;
    const myRound = this.round;
    void ctx.send(ctx.t('game.guessLanguage.round', { n: this.round, total }));
    void ctx.say(cand.phrase, { model: cand.model });
    ctx.after(ROUND_MS, () => {
      if (this.round === myRound && !this.answered) this.onTimeout(ctx);
    });
  }

  private onTimeout(ctx: GameContext): void {
    this.answered = true;
    const name = this.current ? localizedLanguageName(this.current.base, ctx.locale) : '';
    void ctx.send(ctx.t('game.guessLanguage.timeout', { language: name }));
    this.nextRound(ctx);
  }

  onMessage(ctx: GameContext, msg: GameMessage): void {
    if (this.answered || !this.current) return;
    if (!this.answers.has(normalizeAnswer(msg.content))) return;
    this.answered = true;
    ctx.award(msg.authorId, 1);
    const entry = this.tally.get(msg.authorId) ?? { name: msg.authorName, points: 0 };
    entry.points += 1;
    entry.name = msg.authorName;
    this.tally.set(msg.authorId, entry);
    const language = localizedLanguageName(this.current.base, ctx.locale);
    void ctx.send(ctx.t('game.guessLanguage.correct', { user: msg.authorName, language }));
    this.nextRound(ctx);
  }

  private async finish(ctx: GameContext): Promise<void> {
    const ranked = [...this.tally.values()].sort((a, b) => b.points - a.points);
    if (ranked.length === 0) {
      await ctx.send(ctx.t('game.finish.noScores'));
    } else {
      const lines = ranked.map((r, i) =>
        ctx.t('game.finish.line', { rank: i + 1, user: r.name, points: r.points }),
      );
      await ctx.send(`${ctx.t('game.finish.title')}\n${lines.join('\n')}`);
    }
    ctx.end();
  }
}

export const guessLanguageDef: GameDefinition = {
  id: 'guess-language',
  nameKey: 'game.guessLanguage.name',
  descKey: 'game.guessLanguage.desc',
  needsVoice: true,
  create: () => new GuessLanguageGame(),
};
