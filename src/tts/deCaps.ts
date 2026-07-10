// src/tts/deCaps.ts — baixa palavras TODO-MAIÚSCULAS antes da síntese.
//
// PORQUÊ: vários motores de TTS SOLETRAM palavras todo-em-maiúsculas — leem "AJUDA"
// como "A-J-U-D-A" (tratam-nas como sigla) em vez de as ler como PALAVRA. Em chat, o
// TODO-MAIÚSCULAS é quase sempre ênfase/gritar (não uma sigla), por isso baixamo-lo
// para o motor ler a palavra. O "grito" em si (mais alto) é aplicado À PARTE, na
// reprodução, como ganho de VOLUME (ver emphasis.ts) — logo baixar as maiúsculas aqui
// NÃO tira a ênfase, só evita que a palavra saia soletrada.
//
// Uma ÚNICA maiúscula (início de frase, "I", "A", ou o "V" de "Voltei") NÃO é tocada —
// só CORRIDAS de 2+. \p{M} apanha diacríticos combinados (ÁÁ). PURA.
//
// Partilhado: o gTTS usa-o (deCapsForGoogle) e é aplicado também no Kokoro, no Clone e
// no Neural, que não tinham este passo. O Piper é a EXCEÇÃO — lê maiúsculas como palavra
// (ver accents.ts, que até RE-maiúscula acentos restaurados sem problema), por isso lá
// é desnecessário e não o aplicamos.

const RE_ALLCAPS_RUN = /\p{Lu}[\p{Lu}\p{M}]+/gu;

/** Baixa para minúsculas as corridas de 2+ maiúsculas no texto. PURA. */
export function lowerAllCapsRuns(text: string): string {
  return text.replace(RE_ALLCAPS_RUN, (run) => run.toLowerCase());
}
