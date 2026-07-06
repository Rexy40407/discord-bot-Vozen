import type { Game, GameContext, GameDefinition, GameMessage } from './types';
import { bump, sendStandings, type Tally } from './finish';
import { pickWordSource, type WordSource } from './content/words';
import { makeRng, normalizeAnswer, seededShuffle } from './util';

const ROUNDS = 6;
const REACT_MS = 12_000;
/** Probabilidade (em 10) de a ordem ser REAL ("Vozi diz"). O resto sao ratoeiras. */
const REAL_IN_TEN = 6;

/**
 * "Vozi Diz" (Simon Says) — o Vozi manda escrever uma palavra. So se obedece quando a
 * ordem comeca por "Vozi diz": nesse caso o 1o a escrever a palavra ganha o ponto. Se
 * NAO tiver "Vozi diz" (ratoeira), quem escrever a palavra e APANHADO (vergonha, sem
 * ponto); quem se aguentar sobrevive. Palavras da lingua da voz default da guild.
 *
 * Nao ha penalizacao negativa (mantem o placar simples/nao-negativo): as ratoeiras sao
 * momentos de gozo, os pontos vem so das ordens reais cumpridas.
 */
class VoziSaysGame implements Game {
  readonly id = 'vozi-says';
  private src: WordSource | null = null;
  private items: string[] = [];
  private round = 0;
  private item = '';
  private real = false;
  private done = false;
  private readonly caught = new Set<string>();
  private rng: () => number = () => 0;
  private readonly tally: Tally = new Map();

  async start(ctx: GameContext): Promise<void> {
    this.rng = makeRng(ctx.seed);
    this.src = pickWordSource(ctx.defaultVoice, ctx.availableModels);
    this.items = seededShuffle(this.src.words, ctx.seed);
    if (this.items.length === 0) {
      await ctx.send(ctx.t('game.spelling.empty'));
      ctx.end();
      return;
    }
    await ctx.send(ctx.t('game.voziSays.intro', { rounds: ROUNDS }));
    this.nextRound(ctx);
  }

  private nextRound(ctx: GameContext): void {
    if (this.round >= ROUNDS) {
      void this.finish(ctx);
      return;
    }
    this.item = this.items[this.round % this.items.length];
    this.real = this.rng() % 10 < REAL_IN_TEN;
    this.round++;
    this.done = false;
    this.caught.clear();
    const my = this.round;
    const prefix = ctx.t('game.voziSays.prefix');
    const verb = ctx.t('game.voziSays.verb');
    // Texto FALADO da ordem (na voz da guild): com/sem o "Vozi diz" a frente.
    const spoken = this.real ? `${prefix}, ${verb} ${this.item}` : `${verb} ${this.item}`;
    void ctx.send(
      ctx.t(this.real ? 'game.voziSays.real' : 'game.voziSays.trap', {
        n: this.round,
        total: ROUNDS,
        command: spoken,
      }),
    );
    void ctx.say(spoken, { model: this.src!.model });
    ctx.after(REACT_MS, () => {
      if (this.round === my && !this.done) this.onTimeout(ctx);
    });
  }

  onMessage(ctx: GameContext, msg: GameMessage): void {
    if (this.done) return;
    if (normalizeAnswer(msg.content) !== normalizeAnswer(this.item)) return; // so reage a palavra
    if (this.real) {
      this.done = true;
      ctx.award(msg.authorId, 1);
      bump(this.tally, msg.authorId, msg.authorName, 1);
      void ctx.send(ctx.t('game.voziSays.obeyed', { user: msg.authorName }));
      this.nextRound(ctx);
    } else {
      // Ratoeira: apanhado. Nao termina a ronda (outros ainda podem cair); so gozo.
      if (this.caught.has(msg.authorId)) return;
      this.caught.add(msg.authorId);
      void ctx.send(ctx.t('game.voziSays.caught', { user: msg.authorName }));
    }
  }

  private onTimeout(ctx: GameContext): void {
    this.done = true;
    void ctx.send(
      ctx.t(this.real ? 'game.voziSays.nobody' : 'game.voziSays.trapCleared', { word: this.item }),
    );
    this.nextRound(ctx);
  }

  private async finish(ctx: GameContext): Promise<void> {
    await sendStandings(ctx, this.tally);
    ctx.end();
  }
}

export const voziSaysDef: GameDefinition = {
  id: 'vozi-says',
  nameKey: 'game.voziSays.name',
  descKey: 'game.voziSays.desc',
  needsVoice: true,
  create: () => new VoziSaysGame(),
};
