// src/language/speakerName.ts
//
// Sanitiza o nome do autor para ser LIDO em voz alta pelo xsaid. Nomes de Discord
// vêm cheios de emojis, símbolos e underscores ("🔥xX_Pro_Xx🔥") que soam a lixo no
// TTS. Aqui tiramos o que não é fala e deixamos algo pronunciável. PURO.

const RE_CUSTOM_EMOJI = /<a?:\w+:\d+>/g;
const RE_PICTOGRAPHIC = /\p{Extended_Pictographic}/gu;
// Mantém SÓ letras, números, espaços e separadores suaves (- e apóstrofos). Tudo o
// resto — símbolos decorativos (▓★|~), e também os componentes zero-width de emoji
// (ZWJ, VS16, keycap) e regional indicators, que não são \p{L}/\p{N}/espaço — cai aqui.
const RE_DECOR = /[^\p{L}\p{N}\s\-'’]/gu;
const RE_WS = /\s+/g;
const MAX_NAME_CHARS = 40;

/**
 * Devolve um nome pronunciável, ou '' se depois de limpar não sobra nada legível
 * (nome 100% emojis) — o chamador decide o fallback (username / genérico / sem xsaid).
 */
export function sanitizeSpeakerName(raw: string): string {
  let s = raw
    .replace(RE_CUSTOM_EMOJI, ' ')
    .replace(RE_PICTOGRAPHIC, ' ')
    .replace(/_/g, ' ')
    .replace(RE_DECOR, ' ')
    .replace(RE_WS, ' ')
    .trim();
  if (s.length > MAX_NAME_CHARS) s = s.slice(0, MAX_NAME_CHARS).trim();
  // Só vale como nome se tiver pelo menos uma letra/número.
  return /[\p{L}\p{N}]/u.test(s) ? s : '';
}
