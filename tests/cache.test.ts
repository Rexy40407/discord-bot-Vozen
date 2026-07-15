// tests/cache.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  utimesSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheKey, AudioCache } from '../src/tts/cache';
import type { SynthRequest } from '../src/tts/engine';

// Keeps the REAL unlinkSync implementation so it can be restored in afterEach (mockReset
// also clears the default impl). `vi.hoisted` runs before the vi.mock factory, so the ref
// is available inside it.
const realFs = vi.hoisted(() => {
  const actual = require('node:fs') as typeof import('node:fs');
  return { unlinkSync: actual.unlinkSync };
});

// node:fs mock that KEEPS the real implementations (spread `...actual`) and only wraps
// `readdirSync`/`unlinkSync` in spies. `readdirSync` is spied to COUNT calls (proof that
// the in-memory evict() no longer does a directory scan on the hot path — plan 020);
// `unlinkSync` is forced to throw in a specific test (file already removed outside the
// process). The remaining tests with REAL fs stay green.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readdirSync: vi.fn(actual.readdirSync),
    unlinkSync: vi.fn(actual.unlinkSync),
  };
});

describe('cacheKey', () => {
  const base: SynthRequest = { text: 'ola mundo', model: 'pt_PT', speed: 1 };

  it('is stable: same request -> same key', () => {
    expect(cacheKey(base)).toBe(cacheKey({ ...base }));
  });

  it('is a sha1 hex hash (40 chars)', () => {
    expect(cacheKey(base)).toMatch(/^[0-9a-f]{40}$/);
  });

  it('changes when the text changes', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, text: 'outro texto' }));
  });

  it('changes when the model changes', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, model: 'en_US' }));
  });

  it('changes when the speed changes', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, speed: 1.5 }));
  });

  it('does not confuse field boundaries (text vs model)', () => {
    // 'ab' + 'c' must not collide with 'a' + 'bc'
    const a: SynthRequest = { text: 'ab', model: 'c', speed: 1 };
    const b: SynthRequest = { text: 'a', model: 'bc', speed: 1 };
    expect(cacheKey(a)).not.toBe(cacheKey(b));
  });

  it('does not collide on field boundaries', () => {
    const a = cacheKey({ text: 'a b', model: 'c', speed: 1 });
    const b = cacheKey({ text: 'a', model: 'b c', speed: 1 });
    expect(a).not.toBe(b);
  });

  // ── leadSilenceMs: a silence PREPEND affects the audio -> must affect the key ──
  it('changes when leadSilenceMs changes', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, leadSilenceMs: 2000 }));
  });

  it('back-compat: leadSilenceMs undefined vs 0 -> SAME key (equal to no silence)', () => {
    const noField = cacheKey(base); // leadSilenceMs undefined
    const zero = cacheKey({ ...base, leadSilenceMs: 0 });
    expect(zero).toBe(noField);
  });

  it('distinct leadSilenceMs values -> distinct keys', () => {
    expect(cacheKey({ ...base, leadSilenceMs: 1000 })).not.toBe(
      cacheKey({ ...base, leadSilenceMs: 2000 }),
    );
  });
});

describe('AudioCache', () => {
  let dir: string;
  let srcDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ttscache-'));
    srcDir = mkdtempSync(join(tmpdir(), 'ttssrc-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  });

  it('get returns null for a nonexistent key', () => {
    const cache = new AudioCache(dir);
    expect(cache.get('naoexiste')).toBeNull();
  });

  it('put SURVIVES the folder being deleted at runtime (regression: /voice clone delete purge)', () => {
    // The privacy purge deletes the ENTIRE audio-cache/clone/ at runtime; the constructor
    // only does mkdir once. Without the mkdir in put(), all synthesis for that namespace fell
    // into ENOENT (fallback to the normal voice) until the next restart — the real production bug.
    const cache = new AudioCache(dir).withNamespace('clone');
    const src = join(srcDir, 'clonado.wav');
    writeFileSync(src, Buffer.from('RIFFclone'));
    rmSync(join(dir, 'clone'), { recursive: true, force: true }); // simulates the purge
    const stored = cache.put('chave-pos-purge', src);
    expect(existsSync(stored)).toBe(true);
    expect(readFileSync(stored).toString()).toBe('RIFFclone');
  });

  it('put copies the file to the dir and returns the path; get returns it afterwards', () => {
    const cache = new AudioCache(dir);
    const src = join(srcDir, 'gerado.wav');
    writeFileSync(src, Buffer.from('RIFFfakewav'));

    const stored = cache.put('chave1', src);

    expect(existsSync(stored)).toBe(true);
    expect(stored).toBe(join(dir, 'chave1.wav'));
    expect(readFileSync(stored).toString()).toBe('RIFFfakewav');
    expect(cache.get('chave1')).toBe(stored);
  });

  it('put does not delete the source file (copy, not move)', () => {
    const cache = new AudioCache(dir);
    const src = join(srcDir, 'gerado.wav');
    writeFileSync(src, Buffer.from('dados'));

    cache.put('chave2', src);

    expect(existsSync(src)).toBe(true);
  });

  it('creates the dir if it does not exist', () => {
    const nested = join(dir, 'sub', 'cache');
    const cache = new AudioCache(nested);
    const src = join(srcDir, 'g.wav');
    writeFileSync(src, Buffer.from('x'));
    const stored = cache.put('k', src);
    expect(existsSync(stored)).toBe(true);
  });

  // Bug-hunt 2026-07: put() used to write with copyFileSync straight to the final path, so
  // a concurrent get() could serve a .wav truncated mid-copy. It now writes via tmp +
  // renameSync (atomic). Verifies that no .tmp junk is left and that put over an existing
  // key is idempotent (does not corrupt).
  it('put is atomic: leaves no .tmp files in the dir', () => {
    const cache = new AudioCache(dir);
    const src = join(srcDir, 'a.wav');
    writeFileSync(src, Buffer.from('RIFFdados'));
    cache.put('chaveA', src);
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp'));
    expect(leftovers).toEqual([]);
    expect(existsSync(join(dir, 'chaveA.wav'))).toBe(true);
  });

  it('put over an already existing key is idempotent (returns the path, content intact)', () => {
    const cache = new AudioCache(dir);
    const src = join(srcDir, 'b.wav');
    writeFileSync(src, Buffer.from('RIFFprimeiro'));
    const first = cache.put('chaveB', src);
    // second put of the same key (deterministic content) — returns the same path.
    const second = cache.put('chaveB', src);
    expect(second).toBe(first);
    expect(readFileSync(first).toString()).toBe('RIFFprimeiro');
    expect(readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([]);
  });
});

describe('AudioCache.withNamespace', () => {
  let dir: string;
  let srcDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ttscache-ns-'));
    srcDir = mkdtempSync(join(tmpdir(), 'ttssrc-ns-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  });

  it('different namespaces resolve to distinct subdirectories', () => {
    const base = new AudioCache(dir);
    const piper = base.withNamespace('piper');
    const neural = base.withNamespace('neural');

    const src = join(srcDir, 'out.wav');
    writeFileSync(src, Buffer.from('audio'));

    const piperPath = piper.put('chave', src);
    const neuralPath = neural.put('chave', src);

    expect(piperPath).toContain('piper');
    expect(neuralPath).toContain('neural');
    expect(piperPath).not.toBe(neuralPath);
  });

  it('a hit in one namespace is not visible in the other (no cross-contamination)', () => {
    const base = new AudioCache(dir);
    const piper = base.withNamespace('piper');
    const neural = base.withNamespace('neural');

    const src = join(srcDir, 'out.wav');
    writeFileSync(src, Buffer.from('audio'));

    piper.put('chave', src);

    // 'neural' does not have the key — must not find 'piper''s file
    expect(neural.get('chave')).toBeNull();
  });

  it('same key in different namespaces does not collide — each reads its own file', () => {
    // cacheKey would be identical for the same SynthRequest, but the dir is different
    const base = new AudioCache(dir);
    const piper = base.withNamespace('piper');
    const neural = base.withNamespace('neural');

    const src = join(srcDir, 'out.wav');
    writeFileSync(src, Buffer.from('audio-piper'));

    const src2 = join(srcDir, 'out2.wav');
    writeFileSync(src2, Buffer.from('audio-neural'));

    piper.put('abc123', src);
    neural.put('abc123', src2);

    // Each namespace reads its own file
    expect(piper.get('abc123')).toBeTruthy();
    expect(neural.get('abc123')).toBeTruthy();
    expect(piper.get('abc123')).not.toBe(neural.get('abc123'));
  });

  it('withNamespace creates the subdirectory automatically', () => {
    const base = new AudioCache(dir);
    const ns = base.withNamespace('someengine');
    const src = join(srcDir, 'out.wav');
    writeFileSync(src, Buffer.from('x'));
    const stored = ns.put('k', src);
    expect(existsSync(stored)).toBe(true);
  });

  it('withNamespace inherits the parent maxFiles', () => {
    const base = new AudioCache(dir, 2);
    const ns = base.withNamespace('eng');
    // Writes 3 files; the oldest must be removed
    const t0 = new Date(Date.now() - 3000);
    const t1 = new Date(Date.now() - 2000);
    const t2 = new Date(Date.now() - 1000);

    const makeWav = (name: string) => {
      const p = join(srcDir, name);
      writeFileSync(p, Buffer.from('x'));
      return p;
    };

    const s0 = makeWav('a.wav');
    const s1 = makeWav('b.wav');
    const s2 = makeWav('c.wav');

    const p0 = ns.put('key0', s0);
    utimesSync(p0, t0, t0);
    const p1 = ns.put('key1', s1);
    utimesSync(p1, t1, t1);
    // Third put must trigger eviction of key0
    ns.put('key2', s2);
    utimesSync(join(ns['dir'], 'key2.wav'), t2, t2);

    const remaining = readdirSync(ns['dir']).filter((f) => f.endsWith('.wav'));
    expect(remaining.length).toBeLessThanOrEqual(2);
    // key0 (oldest) was removed
    expect(existsSync(p0)).toBe(false);
  });
});

describe('AudioCache eviction (maxFiles)', () => {
  let dir: string;
  let srcDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ttscache-evict-'));
    srcDir = mkdtempSync(join(tmpdir(), 'ttssrc-evict-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  });

  function makeSrc(name: string, content = 'wav'): string {
    const p = join(srcDir, name);
    writeFileSync(p, Buffer.from(content));
    return p;
  }

  it('below the cap: no file is removed', () => {
    const cache = new AudioCache(dir, 5);
    for (let i = 0; i < 5; i++) {
      cache.put(`k${i}`, makeSrc(`f${i}.wav`));
    }
    const files = readdirSync(dir).filter((f) => f.endsWith('.wav'));
    expect(files.length).toBe(5);
  });

  it('when exceeding the cap, the oldest are removed', () => {
    const cache = new AudioCache(dir, 3);
    const now = Date.now();

    // Writes 3 files with deterministic mtimes (old)
    const paths: string[] = [];
    for (let i = 0; i < 3; i++) {
      const dest = cache.put(`old${i}`, makeSrc(`old${i}.wav`));
      const t = new Date(now - (3 - i) * 1000); // old0 oldest
      utimesSync(dest, t, t);
      paths.push(dest);
    }

    // 4th put exceeds the cap (cap=3): must remove the oldest (old0)
    const newest = cache.put('new0', makeSrc('new0.wav'));

    const remaining = readdirSync(dir).filter((f) => f.endsWith('.wav'));
    expect(remaining.length).toBeLessThanOrEqual(3);
    expect(existsSync(paths[0])).toBe(false); // old0 removed
    expect(existsSync(newest)).toBe(true); // the just-written one is never removed
  });

  it('when exceeding by more than 1, removes all the oldest surplus', () => {
    const cache = new AudioCache(dir, 2);
    const now = Date.now();

    // Writes 4 files with spaced mtimes
    const p: string[] = [];
    for (let i = 0; i < 4; i++) {
      const dest = cache.put(`k${i}`, makeSrc(`f${i}.wav`));
      utimesSync(dest, new Date(now - (4 - i) * 2000), new Date(now - (4 - i) * 2000));
      p.push(dest);
    }
    // After 4 puts with cap=2, the directory must have at most 2 files
    const remaining = readdirSync(dir).filter((f) => f.endsWith('.wav'));
    expect(remaining.length).toBeLessThanOrEqual(2);
    // The most recent (k3) must survive
    expect(existsSync(p[3])).toBe(true);
  });

  it('the just-written file is never evicted even with cap=1', () => {
    const cache = new AudioCache(dir, 1);
    const now = Date.now();

    // Writes an old file
    const old = cache.put('old', makeSrc('old.wav'));
    utimesSync(old, new Date(now - 5000), new Date(now - 5000));

    // 2nd put exceeds cap: old must go, new must stay
    const newest = cache.put('new', makeSrc('new.wav'));
    expect(existsSync(newest)).toBe(true);
    expect(existsSync(old)).toBe(false);
  });

  it('maxFiles=0 disables eviction (no removals)', () => {
    const cache = new AudioCache(dir, 0);
    for (let i = 0; i < 10; i++) {
      cache.put(`k${i}`, makeSrc(`f${i}.wav`));
    }
    const files = readdirSync(dir).filter((f) => f.endsWith('.wav'));
    expect(files.length).toBe(10);
  });

  // Plan 020: the eviction order now comes from an in-memory LRU index (insertion/access
  // order), not from the on-disk mtime — get() no longer does utimesSync.
  it('get() refreshes the accessed key: eviction now takes the SECOND oldest', () => {
    // maxFiles=3: a, b, c fit without evict. get('a') refreshes 'a' to the end of the index
    // (most recent). The 4th put ('d') exceeds the cap -> evicts the oldest in the index,
    // which is now 'b' (not 'a') — proving the order comes from access via the index, not
    // from an on-disk mtime that is no longer touched.
    const cache = new AudioCache(dir, 3);
    const a = cache.put('a', makeSrc('a.wav'));
    const b = cache.put('b', makeSrc('b.wav'));
    const c = cache.put('c', makeSrc('c.wav'));

    expect(cache.get('a')).toBe(a); // hit -> refreshes 'a' to the end of the index

    const d = cache.put('d', makeSrc('d.wav'));

    expect(existsSync(a)).toBe(true); // 'a' survives (it was refreshed by the get)
    expect(existsSync(b)).toBe(false); // 'b' is now the oldest -> evicted
    expect(existsSync(c)).toBe(true);
    expect(existsSync(d)).toBe(true); // the just-written one is never evicted
  });
});

// ── evict defensive branches ─────────────────────────────────────────────────
// Plan 020: evict() no longer does a directory scan (readdirSync/statSync) — the order
// lives in an in-memory LRU index. The defensive branches that REMAIN are: unlinkSync
// failing (file already removed outside the process) and the guard against drift between
// `count`/`lru` (should not happen in normal use — see the plan's maintenance notes — but
// the loop must TERMINATE instead of running forever).
describe('AudioCache.evict — defensive branches', () => {
  let dir: string;
  let srcDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ttscache-def-'));
    srcDir = mkdtempSync(join(tmpdir(), 'ttssrc-def-'));
  });

  afterEach(() => {
    // Restores the REAL implementation (clears any pending mockImplementationOnce) so as not
    // to contaminate the following tests.
    vi.mocked(unlinkSync).mockReset();
    vi.mocked(unlinkSync).mockImplementation(realFs.unlinkSync as never);
    rmSync(dir, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  });

  function makeSrc(name: string, content = 'wav'): string {
    const p = join(srcDir, name);
    writeFileSync(p, Buffer.from(content));
    return p;
  }

  it('unlinkSync failing (file already removed outside the process): evict does not crash', () => {
    // cap=1 forces eviction on the 2nd put. The unlinkSync of the old file throws (e.g.
    // another process already deleted it) — the catch is best-effort and must swallow the error.
    const cache = new AudioCache(dir, 1);

    const old = cache.put('old', makeSrc('old.wav'));

    vi.mocked(unlinkSync).mockImplementationOnce(() => {
      throw new Error('ENOENT: unlinkSync falhou');
    });

    expect(() => cache.put('new', makeSrc('new.wav'))).not.toThrow();

    // The just-written one always survives. `old` remains physically on disk (the mocked
    // unlinkSync never actually deleted it) — the catch swallowed the error and the index
    // moves on all the same (best-effort).
    expect(existsSync(join(dir, 'new.wav'))).toBe(true);
    expect(existsSync(old)).toBe(true);
  });

  it('drift between count and lru: evict stops when only the just-written remains (no infinite loop)', () => {
    // In normal use `count` and `lru.size` always move in lockstep (see the plan 020
    // maintenance notes). This test simulates an artificial corruption of that invariant —
    // access to private fields via bracket notation, the same pattern already used in this
    // suite (e.g. `ns['dir']`) — to prove that the evict() loop TERMINATES instead of running
    // forever when there is no candidate beyond justWritten itself.
    const cache = new AudioCache(dir, 1);
    const dest = cache.put('unico', makeSrc('unico.wav'));

    // Forces count > maxFiles while the index has no key other than `dest`.
    (cache as unknown as { count: number }).count = 5;

    expect(() =>
      (cache as unknown as { evict: (justWritten: string) => void }).evict(dest),
    ).not.toThrow();
    // With no candidate to remove, `count` stays as it was — it does not drop on its own.
    expect((cache as unknown as { count: number }).count).toBe(5);
  });
});

describe('AudioCache in-memory counter', () => {
  let dir: string;
  let srcDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ttscache-count-'));
    srcDir = mkdtempSync(join(tmpdir(), 'ttssrc-count-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  });

  function makeSrc(name: string, content = 'wav'): string {
    const p = join(srcDir, name);
    writeFileSync(p, Buffer.from(content));
    return p;
  }

  it('never does readdir after startup (in-memory LRU index) — neither below nor above the cap', () => {
    // Plan 020: evict() now evicts from the in-memory LRU index, with no directory scan.
    // Before this plan, crossing the cap triggered ~1 readdir per put; now it is ALWAYS zero
    // (only the constructor scan does readdir, a single time).
    const cache = new AudioCache(dir, 5);
    vi.mocked(readdirSync).mockClear(); // the constructor scan does not count for the test
    for (let i = 0; i < 4; i++) cache.put(`k${i}`, makeSrc(`f${i}.wav`));
    // 4 puts <= cap 5 -> ZERO readdir.
    expect(vi.mocked(readdirSync)).not.toHaveBeenCalled();
    // 6th and 7th put cross the cap -> eviction via in-memory index, still WITHOUT readdir.
    cache.put('k4', makeSrc('f4.wav'));
    cache.put('k5', makeSrc('f5.wav'));
    expect(vi.mocked(readdirSync)).not.toHaveBeenCalled();
    expect(readdirSync(dir).filter((f) => f.endsWith('.wav')).length).toBeLessThanOrEqual(5);
  });

  it('warm start: picks up pre-existing files and evicts on the 1st put', () => {
    // 3 files already in the dir BEFORE building the cache (cap 3).
    for (let i = 0; i < 3; i++) writeFileSync(join(dir, `pre${i}.wav`), Buffer.from('x'));
    const cache = new AudioCache(dir, 3);
    cache.put('novo', makeSrc('novo.wav')); // 3 pre + 1 = 4 > cap -> evicts 1
    expect(readdirSync(dir).filter((f) => f.endsWith('.wav')).length).toBeLessThanOrEqual(3);
  });

  it('purging the folder at runtime ZEROES the counter (does not evict improperly afterwards)', () => {
    const cache = new AudioCache(dir, 3);
    for (let i = 0; i < 3; i++) cache.put(`a${i}`, makeSrc(`a${i}.wav`));
    rmSync(dir, { recursive: true, force: true }); // simulates the privacy purge
    // 3 puts of NEW keys: if the counter had stayed at 3, the 1st would cross the cap and
    // evict; with the reset to 0, all 3 survive.
    for (let i = 0; i < 3; i++) cache.put(`b${i}`, makeSrc(`b${i}.wav`));
    expect(readdirSync(dir).filter((f) => f.endsWith('.wav')).length).toBe(3);
  });

  it('purging the folder at runtime also clears the LRU index (post-purge eviction only sees the new keys)', () => {
    // Plan 020: without the `this.lru.clear()` in the dir-recreated branch, the old keys
    // (a0/a1, no longer existing on disk) stayed "stuck" in the index ahead of the new ones.
    // On the next eviction, evict() picked THEM first (unlink fails silently, count-- all the
    // same) instead of the real b* keys — the cap was breached (the dir ended up with MORE
    // files than maxFiles).
    const cache = new AudioCache(dir, 2);
    cache.put('a0', makeSrc('a0.wav'));
    cache.put('a1', makeSrc('a1.wav'));
    rmSync(dir, { recursive: true, force: true }); // simulates the privacy purge

    cache.put('b0', makeSrc('b0.wav'));
    cache.put('b1', makeSrc('b1.wav'));
    const b2 = cache.put('b2', makeSrc('b2.wav')); // 3rd post-purge put exceeds cap=2

    const remaining = readdirSync(dir).filter((f) => f.endsWith('.wav'));
    expect(remaining.length).toBeLessThanOrEqual(2);
    expect(existsSync(b2)).toBe(true); // the just-written one is never evicted
  });

  it('re-writing the SAME key does not count twice', () => {
    const cache = new AudioCache(dir, 2);
    cache.put('k1', makeSrc('k1.wav'));
    cache.put('k1', makeSrc('k1b.wav')); // same key -> exists-first, does not count
    vi.mocked(readdirSync).mockClear();
    cache.put('k2', makeSrc('k2.wav')); // 2 files <= cap 2 -> no readdir/eviction
    expect(vi.mocked(readdirSync)).not.toHaveBeenCalled();
    expect(existsSync(join(dir, 'k1.wav'))).toBe(true);
    expect(existsSync(join(dir, 'k2.wav'))).toBe(true);
  });
});
