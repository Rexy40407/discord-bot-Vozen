// 24/7 in-call — planeamento PURO do rejoin no arranque. Decide, a partir das presenças
// persistidas (voice_presence), o que repor e o que esquecer, SEM tocar em discord.js nem
// na DB (injetam-se os predicados). O wiring real (createVoiceSession + DELETE) vive no
// ClientReady em index.ts; aqui só a política, para ser testável.

import type { VoicePresenceRow } from '../store/voicePresence';

/**
 * Estado do canal persistido, resolvido contra o Discord no momento do arranque:
 *  - 'ready'    -> o canal existe, é de voz e o bot tem Connect+Speak -> repor.
 *  - 'no-perms' -> existe mas faltam permissões -> NÃO repor, mas MANTER a linha (as
 *                  permissões podem voltar; tenta-se de novo no próximo arranque).
 *  - 'gone'     -> canal apagado / já não é de voz -> esquecer (linha morta).
 */
export type ChannelState = 'ready' | 'no-perms' | 'gone';

export interface RejoinPolicyDeps {
  /** A guild é Premium AGORA? (só Premium é reposto — 24/7 é uma vantagem paga.) */
  isPremium: (guildId: string) => boolean;
  /** Estado atual do canal persistido desta guild. */
  channelState: (guildId: string, channelId: string) => ChannelState;
}

export interface RejoinPlan {
  /** Guildas a repor na call (createVoiceSession). */
  rejoin: VoicePresenceRow[];
  /** Guildas cuja linha deve ser apagada (não-Premium ou canal morto). */
  forget: string[];
}

/**
 * Decide o rejoin do arranque. Regras, por linha persistida:
 *  - não-Premium            -> esquecer (rede de segurança: limpa linhas Free antigas).
 *  - Premium + canal 'gone' -> esquecer (o canal desapareceu).
 *  - Premium + 'no-perms'   -> nada (mantém a linha; tenta no próximo arranque).
 *  - Premium + 'ready'      -> repor.
 */
export function planRejoin(rows: VoicePresenceRow[], deps: RejoinPolicyDeps): RejoinPlan {
  const rejoin: VoicePresenceRow[] = [];
  const forget: string[] = [];
  for (const row of rows) {
    if (!deps.isPremium(row.guildId)) {
      forget.push(row.guildId);
      continue;
    }
    const state = deps.channelState(row.guildId, row.channelId);
    if (state === 'gone') {
      forget.push(row.guildId);
    } else if (state === 'ready') {
      rejoin.push(row);
    }
    // 'no-perms' -> nem repor nem esquecer.
  }
  return { rejoin, forget };
}
