// src/store/voiceCloneSweep.ts
//
// DATA-06: reconciliation sweep for ORPHAN .wav files in voice-clones/. `eraseUser`
// (dataLifecycle.ts) and `/voice clone delete` (voice.ts) delete the `user_clone` row and
// ONLY THEN try to delete the file from disk, best-effort (`.catch(()=>{})`/swallowed
// try-catch). If the process dies between the two operations, or the `unlink` throws (e.g.:
// file locked on Windows), the biometric sample becomes ORPHANED — with NO row in the DB
// referencing it — and no future `/privacy erase` finds it.
//
// This module runs on ClientReady (see index.ts): it lists voice-clones/*.wav and deletes
// those that have NO live `sample_path` in `user_clone` pointing to them.
//
// MED-risk (plan 032, STOP condition): the match is done against the REAL VALUES of
// `sample_path` — NEVER by filename heuristic. A wrong match would delete a biometric
// sample still in use. That is why `findOrphanSamplePaths` is a PURE function, testable in
// isolation (without touching disk/DB), and is only called after normalizing BOTH sides
// (see `normalizePath`).

import { readdirSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

/**
 * Normalizes a path for comparison: resolves (absolutizes against the current cwd, resolves
 * `..`/`.`) and, on Windows (case-insensitive filesystem), lowercases it — so a difference
 * in casing is never read as "different files" and generates a false orphan. The process
 * that WRITES (voice.ts) and the one that SWEEPS (this module) always run on the SAME OS, so
 * this normalization is sufficient (there are no cross-OS paths to match).
 */
function normalizePath(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * PURE diff logic (testable without fs/DB): given the ABSOLUTE paths of the .wav files found
 * on disk and the REAL, current `sample_path` values from the `user_clone` table, returns
 * the ORPHAN paths — those that have NO live row pointing to them, after normalizing both
 * sides. Never compares by filename/heuristic.
 */
export function findOrphanSamplePaths(filesOnDisk: string[], livePaths: string[]): string[] {
  const live = new Set(livePaths.map(normalizePath));
  return filesOnDisk.filter((f) => !live.has(normalizePath(f)));
}

export interface SweepResult {
  /** Number of .wav files found in voice-clones/. */
  scanned: number;
  /** Paths of the orphans actually deleted. */
  removed: string[];
  /** Orphans identified but whose unlink failed (e.g.: locked file) — best-effort. */
  failed: { path: string; error: unknown }[];
}

/**
 * Sweeps `voiceClonesDir`, matches each `.wav` against the real `sample_path` values in
 * `user_clone` and deletes from disk those left without a match. The DB read is NOT wrapped
 * in try/catch here on purpose: a query failure (e.g.: locked DB) must abort the whole sweep
 * (propagates to the caller) — never silently fall back to "no live rows", which would
 * delete ALL samples. The caller (ClientReady) is the one that decides the best-effort of
 * startup. Non-existent directory => no-op (bot still has no recordings).
 */
export function sweepOrphanClones(db: Database.Database, voiceClonesDir: string): SweepResult {
  if (!existsSync(voiceClonesDir)) return { scanned: 0, removed: [], failed: [] };

  const filesOnDisk = readdirSync(voiceClonesDir)
    .filter((f) => f.toLowerCase().endsWith('.wav'))
    .map((f) => path.join(voiceClonesDir, f));

  const livePaths = (
    db.prepare('SELECT sample_path FROM user_clone').all() as { sample_path: string }[]
  ).map((r) => r.sample_path);

  const orphans = findOrphanSamplePaths(filesOnDisk, livePaths);

  const removed: string[] = [];
  const failed: { path: string; error: unknown }[] = [];
  for (const f of orphans) {
    try {
      unlinkSync(f);
      removed.push(f);
    } catch (err) {
      // best-effort per file: one failing (lock) must not block the rest.
      failed.push({ path: f, error: err });
    }
  }

  return { scanned: filesOnDisk.length, removed, failed };
}
