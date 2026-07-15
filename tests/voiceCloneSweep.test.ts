import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { saveClone } from '../src/store/voiceClone';
import { findOrphanSamplePaths, sweepOrphanClones } from '../src/store/voiceCloneSweep';

describe('findOrphanSamplePaths (PURE diff logic — DATA-06)', () => {
  it('a file with no matching sample_path is an orphan', () => {
    const orphans = findOrphanSamplePaths(['/data/voice-clones/u1-1.wav'], []);
    expect(orphans).toEqual(['/data/voice-clones/u1-1.wav']);
  });

  it('a file with a matching sample_path is NOT an orphan', () => {
    const live = '/data/voice-clones/u1-1.wav';
    const orphans = findOrphanSamplePaths([live], [live]);
    expect(orphans).toEqual([]);
  });

  it('mix: only the files WITHOUT a live row come back', () => {
    const live = '/data/voice-clones/u1-live.wav';
    const orphan = '/data/voice-clones/u2-orphan.wav';
    const orphans = findOrphanSamplePaths([live, orphan], [live]);
    expect(orphans).toEqual([orphan]);
  });

  it('no files on disk -> no orphans, even with sample_path in the DB', () => {
    expect(findOrphanSamplePaths([], ['/data/voice-clones/x.wav'])).toEqual([]);
  });

  it('with NO live rows -> ALL files on disk are orphans', () => {
    const files = ['/a/1.wav', '/a/2.wav'];
    expect(findOrphanSamplePaths(files, [])).toEqual(files);
  });

  it('normalizes separators/case (Windows is case-insensitive) before comparing', () => {
    // Same path, different spellings (uppercase vs lowercase) — must NOT
    // be treated as an orphan just because of case (a false positive would delete a live sample).
    const onDisk = 'C:\\bot\\voice-clones\\u1-1.wav';
    const inDb = 'C:\\bot\\voice-clones\\U1-1.WAV';
    const orphans = findOrphanSamplePaths([onDisk], [inDb]);
    if (process.platform === 'win32') {
      expect(orphans).toEqual([]); // same file, only case differs -> NOT an orphan
    } else {
      // on other (case-sensitive) OSes these would genuinely be different files — no risk
      // here because the process that writes and the one that sweeps run on the SAME OS.
      expect(orphans).toEqual([onDisk]);
    }
  });

  it('relative vs absolute path of the SAME file resolves to the same normalized form', () => {
    // path.resolve() uses the current cwd — comparing a relative path with its absolute
    // equivalent must not produce a false orphan.
    const abs = join(process.cwd(), 'voice-clones', 'u1-1.wav');
    const orphans = findOrphanSamplePaths([abs], ['voice-clones/u1-1.wav']);
    expect(orphans).toEqual([]);
  });
});

describe('sweepOrphanClones (I/O — DATA-06)', () => {
  let dir: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'voice-clones-sweep-'));
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('STOP-condition: deletes ONLY the orphan; the live sample (referenced by sample_path) survives', () => {
    const livePath = join(dir, 'u1-live.wav');
    const orphanPath = join(dir, 'u2-orphan.wav');
    writeFileSync(livePath, 'RIFFfake-live');
    writeFileSync(orphanPath, 'RIFFfake-orphan');
    // The live row references the REAL path (same way voice.ts writes it: absolute
    // path, join(dirname(dbPath), 'voice-clones', file)).
    saveClone(db, 'u1', livePath, Date.now());

    const result = sweepOrphanClones(db, dir);

    expect(result.removed).toEqual([orphanPath]);
    expect(existsSync(orphanPath)).toBe(false); // orphan deleted
    expect(existsSync(livePath)).toBe(true); // live sample intact
  });

  it('no orphans -> nothing is deleted', () => {
    const livePath = join(dir, 'u1-live.wav');
    writeFileSync(livePath, 'RIFFfake');
    saveClone(db, 'u1', livePath, Date.now());

    const result = sweepOrphanClones(db, dir);

    expect(result.removed).toEqual([]);
    expect(existsSync(livePath)).toBe(true);
  });

  it('nonexistent directory -> no-op (never throws)', () => {
    const result = sweepOrphanClones(db, join(dir, 'nao-existe'));
    expect(result).toEqual({ scanned: 0, removed: [], failed: [] });
  });

  it('ignores non-.wav files (never touches anything else living in the folder)', () => {
    const readme = join(dir, 'README.txt');
    writeFileSync(readme, 'nao e um wav');
    const result = sweepOrphanClones(db, dir);
    expect(result.removed).toEqual([]);
    expect(existsSync(readme)).toBe(true);
  });

  it('user_clone with NO rows -> all .wav on disk are orphans and deleted', () => {
    const a = join(dir, 'a.wav');
    const b = join(dir, 'b.wav');
    writeFileSync(a, 'RIFFa');
    writeFileSync(b, 'RIFFb');
    const result = sweepOrphanClones(db, dir);
    expect(result.removed.sort()).toEqual([a, b].sort());
    expect(existsSync(a)).toBe(false);
    expect(existsSync(b)).toBe(false);
  });

  it('multiple owners with live clones -> none are touched', () => {
    const p1 = join(dir, 'u1.wav');
    const p2 = join(dir, 'u2.wav');
    writeFileSync(p1, 'RIFF1');
    writeFileSync(p2, 'RIFF2');
    saveClone(db, 'u1', p1, Date.now());
    saveClone(db, 'u2', p2, Date.now());
    const result = sweepOrphanClones(db, dir);
    expect(result.removed).toEqual([]);
    expect(existsSync(p1)).toBe(true);
    expect(existsSync(p2)).toBe(true);
  });
});
