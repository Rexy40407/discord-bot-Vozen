// src/games/boardEmojis.ts
//
// Carrega os APPLICATION EMOJIS do tabuleiro de xadrez (26: 12 peças × 2 cores de casa
// + 2 casas vazias) uma vez no arranque, para o render do xadrez desenhar peças a sério
// em vez de letras ASCII. App emojis funcionam em QUALQUER servidor sem Nitro nem slots
// de guild. Best-effort: se o fetch falhar (ou o setup de emojis não tiver corrido), o
// mapa fica vazio e o jogo cai no tabuleiro ASCII — nunca crasha.
//
// Faz upload dos assets com: node tools/upload-chess-emojis.mjs

import type { Client } from 'discord.js';
import { log } from '../logging/logger';

/**
 * Os 34 nomes esperados: {cor}{tipo}{casa} (ex. wpl, bkd) + casas vazias (el, ed) +
 * etiquetas de ficheiro fa..fh (letras A–H em tiles, para não dependermos de indicadores
 * regionais — esses combinam-se em BANDEIRAS aos pares, ex. 🇨🇩=Congo, 🇬🇭=Gana).
 */
export const CHESS_EMOJI_NAMES: readonly string[] = (() => {
  const names: string[] = ['el', 'ed'];
  for (const color of ['w', 'b']) {
    for (const type of ['p', 'n', 'b', 'r', 'q', 'k']) {
      for (const sq of ['l', 'd']) names.push(`${color}${type}${sq}`);
    }
  }
  for (const file of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) names.push(`f${file}`);
  return names;
})();

/**
 * Preenche `target` (por referência) com nome->markup (`<:wpl:123>`) de TODOS os
 * application emojis do bot (tiles de xadrez, wordle, …). Chamar 1x no ClientReady (a
 * `client.application` já está preenchida). Best-effort: falha => mapa fica como está e
 * os jogos caem no render de texto/ASCII. Carrega tudo (só temos tiles próprios), por
 * isso adicionar novos grupos de tiles não exige mexer aqui.
 */
export async function loadBoardEmojis(
  client: Client,
  target: Record<string, string>,
): Promise<void> {
  try {
    if (!client.application) return;
    const coll = await client.application.emojis.fetch();
    let n = 0;
    for (const e of coll.values()) {
      if (e.name) {
        target[e.name] = e.toString();
        n++;
      }
    }
    const chess = CHESS_EMOJI_NAMES.filter((name) => target[name]).length;
    log.info(
      `[emojis] ${n} tiles loaded (chess ${chess}/${CHESS_EMOJI_NAMES.length})${n === 0 ? '; using ASCII' : ''}`,
    );
  } catch (err) {
    log.warn('[emojis] failed to load tiles; games will use ASCII', err);
  }
}
