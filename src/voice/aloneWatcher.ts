// src/voice/aloneWatcher.ts
//
// Regra de saída do Voxi: SÓ sai do canal de voz quando fica SOZINHO — zero membros
// humanos (não-bots) no seu canal — durante `ALONE_LEAVE_MS` (5 min). Já NÃO sai por
// inatividade de TTS (essa saída foi removida do player). Reage a VoiceStateUpdate.
//
// Defesa contra o bug "timer-fantasma mata a sessão NOVA": o timer é limpo em
// `removePlayer` (o funil de TODAS as saídas — /leave, guildDelete, desistência de
// reconexão, e a própria saída-por-sozinho) E, ao DISPARAR, re-verifica se ainda está
// sozinho antes de sair. PURO/testável: injeta-se a contagem de humanos, a saída e os
// timers (default = setTimeout/clearTimeout globais).

/** 5 minutos sozinho na call -> sai. */
export const ALONE_LEAVE_MS = 5 * 60 * 1000;

export interface AloneWatcherDeps {
  /** ms sozinho até sair (default ALONE_LEAVE_MS). */
  leaveMs?: number;
  /**
   * Nº de humanos (não-bots) no canal de voz do bot nesta guild. `null` = o bot NÃO
   * está num canal de voz (nada a vigiar -> qualquer timer é cancelado).
   */
  humansInBotChannel: (guildId: string) => number | null;
  /** Executa a saída da guild (removePlayer + destroy da ligação). */
  leave: (guildId: string) => void;
  /** Injetáveis para testes; default = setTimeout/clearTimeout globais. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (t: ReturnType<typeof setTimeout>) => void;
}

export class AloneWatcher {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly leaveMs: number;
  private readonly set: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clr: (t: ReturnType<typeof setTimeout>) => void;
  private readonly humans: (guildId: string) => number | null;
  private readonly doLeave: (guildId: string) => void;

  constructor(d: AloneWatcherDeps) {
    this.leaveMs = d.leaveMs ?? ALONE_LEAVE_MS;
    this.humans = d.humansInBotChannel;
    this.doLeave = d.leave;
    this.set = d.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clr = d.clearTimer ?? ((t) => clearTimeout(t));
  }

  /**
   * Re-avalia a guild após uma mudança de estado de voz. Arma o timer se o bot ficou
   * SOZINHO; cancela-o se há alguém (ou se o bot já não está na voz). Idempotente:
   * estar já a contar não re-arma (não estica a janela dos 5 min a cada mute/deafen).
   */
  evaluate(guildId: string): void {
    const n = this.humans(guildId);
    if (n === null || n > 0) {
      this.clear(guildId);
      return;
    }
    // n === 0 -> sozinho.
    if (this.timers.has(guildId)) return;
    const t = this.set(() => {
      this.timers.delete(guildId);
      // RE-VERIFICA no disparo: alguém pode ter entrado no último instante (antes de
      // a VoiceStateUpdate correspondente cancelar o timer). Só sai se AINDA sozinho.
      if (this.humans(guildId) === 0) this.doLeave(guildId);
    }, this.leaveMs);
    this.timers.set(guildId, t);
  }

  /**
   * Cancela o timer de "sozinho" de uma guild. Chamado por `removePlayer` (todos os
   * caminhos de saída) para o timer nunca sobreviver a uma nova sessão. Idempotente.
   */
  clear(guildId: string): void {
    const t = this.timers.get(guildId);
    if (t !== undefined) {
      this.clr(t);
      this.timers.delete(guildId);
    }
  }

  /** Nº de guilds com timer de saída armado (para testes/telemetria). */
  pendingCount(): number {
    return this.timers.size;
  }
}
