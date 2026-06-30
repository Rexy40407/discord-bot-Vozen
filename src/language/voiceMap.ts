/**
 * Mapeia codigos ISO 639-3 (output de detectLang) para prefixos de locale
 * usados nos nomes de modelos Piper (ex. 'por' -> 'pt_', 'eng' -> 'en_').
 */
const LANG_TO_PREFIX: Record<string, string> = {
  por: 'pt_',
  eng: 'en_',
  spa: 'es_',
  fra: 'fr_',
  deu: 'de_',
  ita: 'it_',
  nld: 'nl_',
  rus: 'ru_',
};

/**
 * Escolhe um modelo Piper de `available` para a lingua `lang`.
 * Se existir um modelo cujo nome comeca pelo prefixo da lingua, devolve-o.
 * Caso contrario (lang desconhecida, '', ou sem modelo correspondente), devolve `fallback`.
 * PURO: sem efeitos secundarios.
 */
export function pickVoice(lang: string, available: string[], fallback: string): string {
  const prefix = LANG_TO_PREFIX[lang];
  if (!prefix) return fallback;

  const match = available.find((model) => model.startsWith(prefix));
  return match ?? fallback;
}
