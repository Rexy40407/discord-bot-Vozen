import type Database from 'better-sqlite3';

// Clone de voz por-UTILIZADOR (GLOBAL, como as abreviaturas — a voz é da pessoa, não
// do servidor). CONSENT-FIRST: a linha só existe depois de a própria pessoa gravar a
// SUA voz (/voice clone record), e `consent_at` regista quando consentiu. Só o próprio
// pode usar/apagar o seu clone; apagar remove a linha (o chamador apaga o WAV).

export interface CloneRow {
  samplePath: string;
  consentAt: number;
  enabled: boolean;
}

export function getClone(db: Database.Database, userId: string): CloneRow | null {
  const row = db
    .prepare('SELECT sample_path, consent_at, enabled FROM user_clone WHERE user_id = ?')
    .get(userId) as { sample_path: string; consent_at: number; enabled: number } | undefined;
  if (!row) return null;
  return { samplePath: row.sample_path, consentAt: row.consent_at, enabled: row.enabled === 1 };
}

/**
 * Guarda/substitui a amostra do próprio (upsert). Uma regravação PRESERVA o estado
 * `enabled` (quem já usava o clone continua a usá-lo com a amostra nova).
 */
export function saveClone(
  db: Database.Database,
  userId: string,
  samplePath: string,
  now: number,
): void {
  db.prepare(
    `INSERT INTO user_clone (user_id, sample_path, consent_at, enabled)
     VALUES (?, ?, ?, 0)
     ON CONFLICT(user_id) DO UPDATE SET sample_path = excluded.sample_path, consent_at = excluded.consent_at`,
  ).run(userId, samplePath, now);
}

/** Liga/desliga o uso do clone. Devolve false se a pessoa ainda não tem amostra. */
export function setCloneEnabled(db: Database.Database, userId: string, on: boolean): boolean {
  const res = db
    .prepare('UPDATE user_clone SET enabled = ? WHERE user_id = ?')
    .run(on ? 1 : 0, userId);
  return res.changes > 0;
}

/** Apaga o clone; devolve o caminho da amostra (para o chamador apagar o WAV) ou null. */
export function deleteClone(db: Database.Database, userId: string): string | null {
  const row = getClone(db, userId);
  if (!row) return null;
  db.prepare('DELETE FROM user_clone WHERE user_id = ?').run(userId);
  return row.samplePath;
}
