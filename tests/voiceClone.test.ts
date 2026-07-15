import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import {
  getClone,
  saveClone,
  setCloneEnabled,
  deleteClone,
  deleteClonesByTarget,
} from '../src/store/voiceClone';
import { VoicedCollector, pcmToWavFile } from '../src/voice/recorder';

// PCM s16le 48kHz stereo: 192 bytes/ms.
const BYTES_PER_MS = 192;

/** "Voiced" buffer: constant int16 samples well above the noise floor. */
function voiced(ms: number, amplitude = 3000): Buffer {
  const buf = Buffer.alloc(ms * BYTES_PER_MS);
  for (let i = 0; i < buf.length; i += 2) buf.writeInt16LE(amplitude, i);
  return buf;
}
/** Silence buffer (zeros — RMS 0). */
function silence(ms: number): Buffer {
  return Buffer.alloc(ms * BYTES_PER_MS);
}

describe('VoicedCollector — only counts voiced frames', () => {
  it('silence does not count; voice counts; done when the target is reached', () => {
    const c = new VoicedCollector(20); // target: 20ms of SPEECH
    expect(c.push(silence(50))).toBe(false); // 50ms of silence -> 0 counted
    expect(c.voicedMs).toBe(0);
    expect(c.push(voiced(10))).toBe(false); // 10/20
    expect(c.voicedMs).toBe(10);
    expect(c.push(voiced(10))).toBe(true); // 20/20 -> done
    expect(c.done).toBe(true);
    expect(c.voicedMs).toBe(20);
  });

  it('pcm() returns only the voiced frames, in order', () => {
    const c = new VoicedCollector(1000);
    c.push(voiced(5));
    c.push(silence(5));
    c.push(voiced(5));
    expect(c.pcm().length).toBe(10 * BYTES_PER_MS); // 10ms of voice, without the silence
  });

  it('empty buffer is ignored without blowing up', () => {
    const c = new VoicedCollector(10);
    expect(c.push(Buffer.alloc(0))).toBe(false);
    expect(c.voicedMs).toBe(0);
  });
});

// Fake ffmpeg (same pattern as effects.test): 'ok' writes the WAV and exits 0.
function fakeFfmpeg(behavior: 'ok' | 'fail') {
  return ((_ff: string, args: readonly string[]) => {
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: () => void };
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      if (behavior === 'ok') {
        const outPath = args[args.length - 2]; // [..., wavPath, '-y']
        writeFileSync(outPath, Buffer.from('RIFFfake'));
        child.emit('close', 0);
      } else {
        child.stderr.emit('data', Buffer.from('boom'));
        child.emit('close', 1);
      }
    });
    return child;
  }) as any;
}

describe('pcmToWavFile — conversion + writing to the destination', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clone-wav-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('success: creates the destination directory and writes the WAV', async () => {
    const out = join(dir, 'clones', 'user-1.wav');
    const res = await pcmToWavFile(voiced(10), out, {
      ffmpegPath: '/fake/ffmpeg',
      spawnImpl: fakeFfmpeg('ok'),
    });
    expect(res).toBe(out);
    expect(existsSync(out)).toBe(true);
  });

  it('ffmpeg failure -> rejects', async () => {
    await expect(
      pcmToWavFile(voiced(10), join(dir, 'x.wav'), {
        ffmpegPath: '/fake/ffmpeg',
        spawnImpl: fakeFfmpeg('fail'),
      }),
    ).rejects.toThrow(/saiu com 1/);
  });
});

describe('store voiceClone — consent-first, per-user', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('no sample -> null; toggle with no sample -> false', () => {
    expect(getClone(db, 'u1')).toBeNull();
    expect(setCloneEnabled(db, 'u1', true)).toBe(false);
  });

  it('saveClone records sample + consent; enabled off; targetId default = owner', () => {
    saveClone(db, 'u1', '/x/u1.wav', 123);
    expect(getClone(db, 'u1')).toEqual({
      samplePath: '/x/u1.wav',
      consentAt: 123,
      enabled: false,
      targetId: 'u1', // self-clone: target == owner
    });
  });

  it('toggle on/off; re-recording PRESERVES the enabled flag', () => {
    saveClone(db, 'u1', '/x/a.wav', 1);
    expect(setCloneEnabled(db, 'u1', true)).toBe(true);
    expect(getClone(db, 'u1')!.enabled).toBe(true);
    saveClone(db, 'u1', '/x/b.wav', 2); // re-recording
    const c = getClone(db, 'u1')!;
    expect(c.samplePath).toBe('/x/b.wav');
    expect(c.consentAt).toBe(2);
    expect(c.enabled).toBe(true); // preserved
  });

  it('delete returns the path and removes the record; delete with nothing -> null', () => {
    saveClone(db, 'u1', '/x/a.wav', 1);
    expect(deleteClone(db, 'u1')).toBe('/x/a.wav');
    expect(getClone(db, 'u1')).toBeNull();
    expect(deleteClone(db, 'u1')).toBeNull();
  });

  it('is per-user (global, no guild)', () => {
    saveClone(db, 'u1', '/x/a.wav', 1);
    expect(getClone(db, 'u2')).toBeNull();
  });
});

describe('store voiceClone — revocation by the recorded person (Phase 2 compliance)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it("saveClone stores the targetId (A records B's voice)", () => {
    saveClone(db, 'A', '/x/A.wav', 10, 'B'); // owner A, B's voice
    expect(getClone(db, 'A')!.targetId).toBe('B');
  });

  it('the recorded person (B) revokes the clone A made of their voice', () => {
    saveClone(db, 'A', '/x/A.wav', 10, 'B');
    const revoked = deleteClonesByTarget(db, 'B');
    expect(revoked).toEqual([{ ownerId: 'A', samplePath: '/x/A.wav' }]);
    expect(getClone(db, 'A')).toBeNull(); // A's clone is gone
  });

  it("revokes ALL clones made of B's voice (by several people)", () => {
    saveClone(db, 'A', '/x/A.wav', 10, 'B');
    saveClone(db, 'C', '/x/C.wav', 11, 'B');
    saveClone(db, 'D', '/x/D.wav', 12, 'D'); // D's self-clone — must NOT be touched
    const revoked = deleteClonesByTarget(db, 'B');
    expect(revoked.map((r) => r.ownerId).sort()).toEqual(['A', 'C']);
    expect(getClone(db, 'A')).toBeNull();
    expect(getClone(db, 'C')).toBeNull();
    expect(getClone(db, 'D')).not.toBeNull(); // self-clone intact
  });

  it('deleteClonesByTarget does NOT delete the own self-clone (that is deleteClone)', () => {
    saveClone(db, 'B', '/x/B.wav', 10, 'B'); // B's self-clone
    expect(deleteClonesByTarget(db, 'B')).toEqual([]); // owner == target -> excluded
    expect(getClone(db, 'B')).not.toBeNull();
    expect(deleteClone(db, 'B')).toBe('/x/B.wav'); // removed with deleteClone
  });

  it("no clones of X's voice -> empty list", () => {
    expect(deleteClonesByTarget(db, 'ninguem')).toEqual([]);
  });
});
