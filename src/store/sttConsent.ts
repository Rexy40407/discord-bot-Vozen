import type Database from 'better-sqlite3';

// Consentimento para o STT (Fase 4), por-locutor e por-SERVIDOR. CONSENT-FIRST: a linha só
// existe DEPOIS de a pessoa consentir — a sua presença É o consentimento. `hasSttConsent` é o
// GATE que decide se a fala de um locutor entra no receiver de transcrição. Consentir é
// 1-clique-lembrado: pede-se UMA vez por guild e `consent_at` fixa o momento (grants repetidos
// preservam o original). Revogar apaga a linha. NÃO é cacheada: o gate corre uma vez por
// locutor ao ARRANCAR a transcrição (não por-frame), logo a leitura direta chega e evita
// staleness de revogação (relevante p/ RGPD).

export interface SttConsentRow {
  userId: string;
  guildId: string;
  consentAt: number;
}

/** Devolve a linha de consentimento (ou null se a pessoa não consentiu neste servidor). */
export function getSttConsent(
  db: Database.Database,
  userId: string,
  guildId: string,
): SttConsentRow | null {
  const row = db
    .prepare(
      'SELECT user_id, guild_id, consent_at FROM stt_consent WHERE user_id = ? AND guild_id = ?',
    )
    .get(userId, guildId) as { user_id: string; guild_id: string; consent_at: number } | undefined;
  if (!row) return null;
  return { userId: row.user_id, guildId: row.guild_id, consentAt: row.consent_at };
}

/** GATE: a pessoa consentiu a ser transcrita neste servidor? */
export function hasSttConsent(db: Database.Database, userId: string, guildId: string): boolean {
  return getSttConsent(db, userId, guildId) !== null;
}

/**
 * Regista o consentimento (idempotente). Um grant repetido PRESERVA o `consent_at` original
 * (o consentimento é 1-clique-na-vida por servidor; regravar a data apagaria o registo real do
 * momento em que a pessoa consentiu).
 */
export function grantSttConsent(
  db: Database.Database,
  userId: string,
  guildId: string,
  now: number,
): void {
  db.prepare(
    `INSERT INTO stt_consent (user_id, guild_id, consent_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, guild_id) DO NOTHING`,
  ).run(userId, guildId, now);
}

/** Revoga o consentimento (apaga a linha). Devolve true se havia consentimento a revogar. */
export function revokeSttConsent(db: Database.Database, userId: string, guildId: string): boolean {
  const res = db
    .prepare('DELETE FROM stt_consent WHERE user_id = ? AND guild_id = ?')
    .run(userId, guildId);
  return res.changes > 0;
}
