// src/store/gcloudUsage.ts
//
// Contadores MENSAIS de chars do motor Google HD (gcloud), persistentes em SQLite
// (tabela gcloud_usage). Salvaguarda de custo: o motor conta os chars SÓ na chamada real
// à Google (cache-miss) e recusa (cai no gTTS) quando o pool do mês esgota. Em memória um
// restart zerava o mês — por isso vive na BD.
//
// `scope`: 'user' (pool pessoal do Plus), 'pass' (pool partilhado do passe, keyed pelo
// DONO do passe), 'guild' (servidor Premium direto sem passe) ou 'global'.
import type Database from 'better-sqlite3';

export type UsageScope = 'user' | 'pass' | 'guild' | 'global';

/**
 * Chave de mês 'YYYY-MM' em UTC (roda sozinha no dia 1). UTC e não fuso local para o
 * limite ser o mesmo em qualquer servidor/máquina. PURA.
 */
export function monthKeyUTC(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Chars já gastos por este pool (scope,key) no mês dado. Sem linha => 0. */
export function getGcloudMonthlyChars(
  db: Database.Database,
  scope: UsageScope,
  key: string,
  month: string,
): number {
  const row = db
    .prepare('SELECT chars FROM gcloud_usage WHERE scope = ? AND key = ? AND month = ?')
    .get(scope, key, month) as { chars: number } | undefined;
  return row ? row.chars : 0;
}

/**
 * Soma `chars` ao consumo do pool no mês (UPSERT atómico: chars = chars + ?). Uma única
 * escrita SQLite serializada — dois synths concorrentes do mesmo pool não perdem contagem.
 */
export function addGcloudMonthlyChars(
  db: Database.Database,
  scope: UsageScope,
  key: string,
  month: string,
  chars: number,
): void {
  db.prepare(
    `INSERT INTO gcloud_usage (scope, key, month, chars)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(scope, key, month) DO UPDATE SET chars = chars + excluded.chars`,
  ).run(scope, key, month, chars);
}

/**
 * Apaga o consumo PESSOAL de um utilizador (RGPD / `/privacy erase`). Só os pools
 * scope 'user'/'pass' são keyed pelo Discord ID do utilizador — as linhas 'guild'/'global'
 * não são dados dele. Chamado pelo `eraseUser` (dataLifecycle), fora do `USER_ERASE_TABLES`
 * porque a chave é `key`, não `user_id`.
 */
export function deleteUserGcloudUsage(db: Database.Database, userId: string): void {
  db.prepare("DELETE FROM gcloud_usage WHERE key = ? AND scope IN ('user', 'pass')").run(userId);
}

/**
 * Purga de retenção: apaga o consumo de meses ANTERIORES a `cutoffMonth` ('YYYY-MM').
 * Evita que a tabela cresça para sempre (1 linha por pool por mês). Devolve o nº apagado.
 * O mês corrente e os recentes ficam (o gate de custo só olha para o mês atual).
 */
export function purgeOldGcloudUsage(db: Database.Database, cutoffMonth: string): number {
  return db.prepare('DELETE FROM gcloud_usage WHERE month < ?').run(cutoffMonth).changes;
}
