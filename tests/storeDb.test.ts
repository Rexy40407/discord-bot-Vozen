import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { initDb } from '../src/store/db';

// CHARACTERIZATION of the durability settings production actually runs with.
//
// These are NOT set by our code — `initDb` only asks for WAL. better-sqlite3 derives the
// rest (verified empirically 2026-07-16: a raw connection reports synchronous=FULL until
// the first statement runs, then settles on NORMAL under WAL; busy_timeout comes from the
// driver's own 5s default). Reading the code alone suggests the SQLite default of FULL —
// i.e. an fsync per spoken message via bumpTalk — which is NOT what happens. These tests
// pin the real values so an upgrade or an option change that silently reintroduces that
// fsync fails here instead of quietly halving write throughput on the VPS.
//
// A real file DB (not :memory:) — WAL and the fsync behaviour of `synchronous` only
// mean anything on disk, which is what production runs on.
describe('initDb — durability pragmas (characterization)', () => {
  let dir: string;
  let db: Database.Database | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vozen-db-'));
  });
  afterEach(() => {
    db?.close();
    db = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs in WAL mode', () => {
    db = initDb(join(dir, 'test.db'));
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
  });

  it('uses synchronous=NORMAL, so a spoken message does not force an fsync', () => {
    // bumpTalk writes on EVERY read message. With the default synchronous=FULL each of
    // those auto-commits fsyncs the WAL — a disk round-trip per message on the VPS.
    // NORMAL+WAL is the documented crash-safe pairing: a power loss may cost the last
    // transaction, never corruption. 1 === NORMAL in SQLite's pragma encoding.
    db = initDb(join(dir, 'test.db'));
    expect(db.pragma('synchronous', { simple: true })).toBe(1);
  });

  it('sets a busy_timeout so a concurrent reader never fails instantly', () => {
    db = initDb(join(dir, 'test.db'));
    expect(db.pragma('busy_timeout', { simple: true })).toBeGreaterThan(0);
  });

  it('migrates the old vote-only reminder state into the alternating rotation', () => {
    const path = join(dir, 'legacy-promo.db');
    const legacy = new Database(path);
    legacy.exec(`CREATE TABLE vote_promo_state (
      guild_id TEXT PRIMARY KEY,
      last_post_at INTEGER NOT NULL
    )`);
    legacy.prepare('INSERT INTO vote_promo_state VALUES (?, ?)').run('guild-1', 123);
    legacy.close();

    db = initDb(path);
    const columns = db.pragma('table_info(vote_promo_state)') as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain('last_kind');
    expect(
      db.prepare('SELECT last_kind FROM vote_promo_state WHERE guild_id = ?').get('guild-1'),
    ).toEqual({ last_kind: 'vote' });
  });
});
