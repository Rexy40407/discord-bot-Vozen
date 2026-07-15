// src/store/gcloudUsage.ts
//
// MONTHLY char counters for the Google HD engine (gcloud), persisted in SQLite
// (gcloud_usage table). Cost safeguard: the engine counts the chars ONLY on the real call
// to Google (cache-miss) and refuses (falls back to gTTS) when the month's pool is exhausted. In memory a
// restart would reset the month — that's why it lives in the DB.
//
// `scope`: 'user' (Plus personal pool), 'pass' (shared pass pool, keyed by the
// pass OWNER), 'guild' (direct Premium server without a pass) or 'global'.
import type Database from 'better-sqlite3';

export type UsageScope = 'user' | 'pass' | 'guild' | 'global';

/**
 * Month key 'YYYY-MM' in UTC (rolls over on its own on the 1st). UTC and not local timezone so the
 * limit is the same on any server/machine. PURE.
 */
export function monthKeyUTC(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Chars already spent by this pool (scope,key) in the given month. No row => 0. */
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
 * Adds `chars` to the pool's consumption for the month (atomic UPSERT: chars = chars + ?). A single
 * serialized SQLite write — two concurrent synths of the same pool do not lose count.
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
 * Deletes a user's PERSONAL consumption (GDPR / `/privacy erase`). Only the
 * scope 'user'/'pass' pools are keyed by the user's Discord ID — the 'guild'/'global' rows
 * are not their data. Called by `eraseUser` (dataLifecycle), outside `USER_ERASE_TABLES`
 * because the key is `key`, not `user_id`.
 */
export function deleteUserGcloudUsage(db: Database.Database, userId: string): void {
  db.prepare("DELETE FROM gcloud_usage WHERE key = ? AND scope IN ('user', 'pass')").run(userId);
}

/**
 * Retention purge: deletes consumption for months BEFORE `cutoffMonth` ('YYYY-MM').
 * Prevents the table from growing forever (1 row per pool per month). Returns the number deleted.
 * The current month and recent ones stay (the cost gate only looks at the current month).
 */
export function purgeOldGcloudUsage(db: Database.Database, cutoffMonth: string): number {
  return db.prepare('DELETE FROM gcloud_usage WHERE month < ?').run(cutoffMonth).changes;
}
