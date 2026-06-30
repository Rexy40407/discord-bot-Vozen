import franc from 'franc';

/**
 * Deteta a lingua de um texto.
 * Devolve um codigo ISO 639-3 (ex. 'por', 'eng') ou '' se desconhecido/muito curto.
 * PURO: sem efeitos secundarios.
 */
export function detectLang(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';

  const code = franc(trimmed);
  if (code === 'und') return '';
  return code;
}
