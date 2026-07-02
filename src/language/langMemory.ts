// src/language/langMemory.ts — memória adaptativa de língua por-utilizador (T3.2).
//
// PROBLEMA: o franc não distingue texto CURTO de línguas próximas (ex. "isto ta a
// funcionar" → spa 1.00 / por 0.99). Sem contexto, um utilizador português vê frases
// curtas lidas em espanhol. NÃO queremos uma língua-base fixa (o Diogo escolheu
// deteção 100% automática) — queremos que a deteção SIGA o que a pessoa escreve.
//
// SOLUÇÃO: lembrar a última língua detetada COM CONFIANÇA (frase longa/inequívoca ou
// match de léxico de saudações) por (guild, user), com TTL curto. Quando chega um
// fragmento curto/ambíguo, resolve-se para essa língua recente em vez do palpite
// incerto do franc. Assim: escreves "olá" (confiante→por, memoriza) e depois "isto ta
// a funcionar" (ambíguo) sai em PORTUGUÊS. Muda de língua com uma frase clara e a
// memória acompanha. Estado em memória (não persiste); expira sozinho.

/** TTL da memória: após isto sem uso, a entrada é ignorada. */
const TTL_MS = 15 * 60 * 1000;
/** Teto de entradas (anti-crescimento); evict da mais antiga ao exceder. */
const MAX_ENTRIES = 10_000;

interface Entry {
  lang: string;
  ts: number;
}

// Map preserva ordem de inserção → a 1.ª chave é a mais antiga (para o evict simples).
const store = new Map<string, Entry>();

/** Relógio injetável (testes); default Date.now. */
let now: () => number = () => Date.now();
/** SÓ para testes: substitui o relógio. */
export function __setClock(fn: () => number): void {
  now = fn;
}

function keyOf(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

/**
 * Regista a língua detetada com CONFIANÇA para (guild, user). `lang` vazio é ignorado
 * (não apaga uma memória boa anterior). Renova o timestamp e a posição (MRU).
 */
export function rememberLang(guildId: string, userId: string, lang: string): void {
  if (!lang) return;
  const key = keyOf(guildId, userId);
  store.delete(key); // reinsere no fim (MRU) e atualiza
  store.set(key, { lang, ts: now() });
  if (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value as string | undefined;
    if (oldest !== undefined) store.delete(oldest);
  }
}

/**
 * Recorda a língua recente de (guild, user), ou '' se não houver / tiver expirado.
 * Expiração preguiçosa: uma entrada velha é apagada e devolve ''.
 */
export function recallLang(guildId: string, userId: string): string {
  const key = keyOf(guildId, userId);
  const entry = store.get(key);
  if (!entry) return '';
  if (now() - entry.ts > TTL_MS) {
    store.delete(key);
    return '';
  }
  return entry.lang;
}

/** SÓ para testes: limpa toda a memória. */
export function __resetLangMemory(): void {
  store.clear();
}
