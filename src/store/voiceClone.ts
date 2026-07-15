import type Database from 'better-sqlite3';
// CACHED table (read on every message): every setter MUST call invalidate.
import { cached, invalidate } from './cache';

/**
 * Clone TTL: the ONLY cached table with a GLOBAL key (userId, no guild). In sharded
 * mode (separate processes) a write in another shard does not invalidate this process;
 * the TTL bounds the staleness window (relevant for GDPR revocation) to 60s.
 */
const CLONE_TTL_MS = 60_000;

// Per-USER voice clone (GLOBAL, like abbreviations — the voice belongs to the person, not
// the server). CONSENT-FIRST: the row only exists after there is consent, and
// `consent_at` records when. The OWNER (`user_id`) is who recorded it and will SPEAK with the voice;
// `target_id` is the person whose VOICE was recorded (== owner in an auto-clone; different when
// A records B's voice). The owner uses/deletes their clone; BESIDES that, the recorded person
// (`target_id`) can ALWAYS revoke any clone made from their voice (GDPR).

export interface CloneRow {
  samplePath: string;
  consentAt: number;
  enabled: boolean;
  /** Person whose voice was recorded (owner when it is an auto-clone). */
  targetId: string;
}

export function getClone(db: Database.Database, userId: string): CloneRow | null {
  const cachedRow = cached(
    db,
    'user_clone',
    userId,
    () => {
      const row = db
        .prepare(
          'SELECT sample_path, consent_at, enabled, target_id FROM user_clone WHERE user_id = ?',
        )
        .get(userId) as
        { sample_path: string; consent_at: number; enabled: number; target_id: string } | undefined;
      if (!row) return null;
      return {
        samplePath: row.sample_path,
        consentAt: row.consent_at,
        enabled: row.enabled === 1,
        targetId: row.target_id,
      } as CloneRow;
    },
    CLONE_TTL_MS,
  );
  return cachedRow ? { ...cachedRow } : null; // copy: the caller must not mutate the cached value
}

/**
 * Saves/replaces the owner's sample (upsert). `targetId` is the person whose voice was
 * recorded (default = the owner themselves, an auto-clone). A re-recording PRESERVES the
 * `enabled` state (whoever already used the clone keeps using it with the new sample).
 */
export function saveClone(
  db: Database.Database,
  userId: string,
  samplePath: string,
  now: number,
  targetId: string = userId,
): void {
  db.prepare(
    `INSERT INTO user_clone (user_id, sample_path, consent_at, enabled, target_id)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       sample_path = excluded.sample_path,
       consent_at  = excluded.consent_at,
       target_id   = excluded.target_id`,
  ).run(userId, samplePath, now, targetId);
  invalidate(db, 'user_clone', userId);
}

/** Enables/disables use of the clone. Returns false if the person has no sample yet. */
export function setCloneEnabled(db: Database.Database, userId: string, on: boolean): boolean {
  const res = db
    .prepare('UPDATE user_clone SET enabled = ? WHERE user_id = ?')
    .run(on ? 1 : 0, userId);
  invalidate(db, 'user_clone', userId);
  return res.changes > 0;
}

/** Deletes the owner's clone; returns the sample path (for the caller to delete the WAV) or null. */
export function deleteClone(db: Database.Database, userId: string): string | null {
  const row = getClone(db, userId);
  if (!row) return null;
  db.prepare('DELETE FROM user_clone WHERE user_id = ?').run(userId);
  invalidate(db, 'user_clone', userId);
  return row.samplePath;
}

/**
 * Revocation by the recorded person: deletes ALL clones made from `targetId`'s voice
 * by OTHER people (owner ≠ target), withdraws consent. Returns the pairs
 * (owner, sample path) for the caller to delete the WAVs. An auto-clone (owner == target)
 * is NOT touched here — that one is removed with `deleteClone` (the owner is the same person).
 */
export function deleteClonesByTarget(
  db: Database.Database,
  targetId: string,
): { ownerId: string; samplePath: string }[] {
  const rows = db
    .prepare('SELECT user_id, sample_path FROM user_clone WHERE target_id = ? AND user_id <> ?')
    .all(targetId, targetId) as { user_id: string; sample_path: string }[];
  if (rows.length === 0) return [];
  db.prepare('DELETE FROM user_clone WHERE target_id = ? AND user_id <> ?').run(targetId, targetId);
  // Invalidate the cache of EACH affected owner (the DELETE removed several rows).
  for (const r of rows) invalidate(db, 'user_clone', r.user_id);
  return rows.map((r) => ({ ownerId: r.user_id, samplePath: r.sample_path }));
}
