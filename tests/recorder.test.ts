import { describe, it, expect } from 'vitest';
import { Readable, Transform } from 'node:stream';
import { VoicedCollector, recordUserSample } from '../src/voice/recorder';
import type { VoiceConnection } from '@discordjs/voice';

// 48kHz stereo 16-bit => 192 bytes/ms (same BYTES_PER_MS math as in recorder.ts).
const BYTES_PER_MS = 192;

/** Block of "spoken" PCM (amplitude well above the noise floor, RMS >= 500). */
function voicedChunk(ms: number): Buffer {
  const buf = Buffer.alloc(ms * BYTES_PER_MS);
  for (let i = 0; i + 1 < buf.length; i += 2) buf.writeInt16LE(12000, i);
  return buf;
}

/** Block of "silent" PCM (zero amplitude, RMS < 500). */
function silentChunk(ms: number): Buffer {
  return Buffer.alloc(ms * BYTES_PER_MS);
}

describe('VoicedCollector', () => {
  it('only counts VOICED bytes (RMS >= threshold) toward the target', () => {
    const c = new VoicedCollector(100); // target: 100ms of speech
    expect(c.push(silentChunk(500))).toBe(false); // silence never fills the target
    expect(c.voicedMs).toBe(0);
    expect(c.push(voicedChunk(50))).toBe(false);
    expect(c.voicedMs).toBe(50);
    expect(c.push(voicedChunk(50))).toBe(true); // hit the target now
    expect(c.done).toBe(true);
  });

  it('pcm() concatenates only the voiced chunks (silence is left out)', () => {
    const c = new VoicedCollector(1000);
    const v = voicedChunk(10);
    c.push(silentChunk(10));
    c.push(v);
    expect(c.pcm()).toEqual(v);
  });

  // RMS gate diagnostics: with the floor at 350, audio at level ~300 (weak speech / mic with
  // low gain) is SEEN but REJECTED — this is exactly the "I recorded 15s, only 2s came out"
  // scenario. The test proves framesSeen/framesVoiced/rmsStats distinguish "gate ate it" from
  // "user barely spoke".
  it('framesSeen counts everything, framesVoiced only what passes the gate; rmsStats reports the distribution', () => {
    const amp = (level: number, ms: number): Buffer => {
      const buf = Buffer.alloc(ms * BYTES_PER_MS);
      for (let i = 0; i + 1 < buf.length; i += 2) buf.writeInt16LE(level, i);
      return buf;
    };
    const c = new VoicedCollector(10_000, 350); // explicit floor = 350
    c.push(amp(300, 20)); // below the gate — seen but does not count (weak speech)
    c.push(amp(300, 20));
    c.push(amp(12000, 20)); // well above — counts
    expect(c.framesSeen).toBe(3);
    expect(c.framesVoiced).toBe(1);
    const s = c.rmsStats();
    expect(s.min).toBe(300);
    expect(s.max).toBe(12000);
    expect(s.median).toBeGreaterThanOrEqual(300);
  });
});

// Fake "subscribe": returns a plain Readable (with no _destroy of its own, like the
// real AudioReceiveStream) that the test feeds manually via push().
function fakeSubscribe(): Readable {
  return new Readable({ read() {} });
}

// Fake "decoder": a plain passthrough Transform (with no _destroy of its own, like the
// real prism.opus.Decoder) — reproduces EXACTLY the same stream surface as the
// production code, including the trait that causes the bug: destroying the source
// (opus) does NOT propagate to the destination (decoder) via stream.pipe().
function fakePassthroughDecoder(): Transform {
  return new Transform({
    transform(chunk, _enc, cb) {
      cb(null, chunk);
    },
  });
}

const FAKE_CONNECTION = {} as VoiceConnection;

describe('recordUserSample — a round never gets stuck (regression of destroy() propagation)', () => {
  // In these tests, stream.pipe() does NOT propagate destroy() from source to destination (this
  // is Node's real behavior — confirmed experimentally). If the code goes back to destroying only
  // `opus` (without also destroying `decoder`) at any of the 3 early-stop points, these tests
  // hang until the test timeout.

  it('the "Stop" button (shouldStop) ends the recording quickly, even mid-speech', async () => {
    let stopped = false;
    const opus = fakeSubscribe();
    const promise = recordUserSample(
      FAKE_CONNECTION,
      'user1',
      { targetVoicedMs: 10_000, maxWallMs: 20_000, shouldStop: () => stopped },
      { subscribe: () => opus, makeDecoder: fakePassthroughDecoder },
    );
    // Speak a little (far from the 10s target) and only then ask to stop.
    opus.push(voicedChunk(50));
    await new Promise((r) => setTimeout(r, 250));
    stopped = true; // simulates the click on the "Stop" button

    const start = Date.now();
    const result = await promise;
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1500); // the internal poll is 200ms — it should never take seconds
    expect(result.voicedMs).toBeGreaterThan(0);
    expect(result.voicedMs).toBeLessThan(10_000); // did not hit the target — stopped because of Stop
  }, 5_000);

  it('hitting the target IN THE MIDDLE of continuous speech (no natural pause) ends immediately', async () => {
    const opus = fakeSubscribe();
    const promise = recordUserSample(
      FAKE_CONNECTION,
      'user2',
      { targetVoicedMs: 100, maxWallMs: 10_000 }, // small target to keep the test fast
      { subscribe: () => opus, makeDecoder: fakePassthroughDecoder },
    );
    // A single burst of continuous speech, with no silence afterward — the source
    // NEVER reaches a natural end; only "target reached -> destroy()" can finish this.
    opus.push(voicedChunk(200));

    const result = await promise;
    expect(result.voicedMs).toBeGreaterThanOrEqual(100);
  }, 5_000);

  it('onProgress is notified with the accumulated speech ms while recording', async () => {
    const opus = fakeSubscribe();
    const seen: number[] = [];
    const promise = recordUserSample(
      FAKE_CONNECTION,
      'userP',
      { targetVoicedMs: 200, maxWallMs: 10_000, onProgress: (ms) => seen.push(ms) },
      { subscribe: () => opus, makeDecoder: fakePassthroughDecoder },
    );
    opus.push(voicedChunk(120));
    opus.push(voicedChunk(120)); // passes the 200ms target -> ends
    const result = await promise;
    expect(result.voicedMs).toBeGreaterThanOrEqual(200);
    // Reported progress at least once and the last value matches the total.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(result.voicedMs);
  }, 5_000);

  it('a decoder error destroys the opus source (does not leak the subscription)', async () => {
    const opuses: Readable[] = [];
    const decoders: Transform[] = [];
    let stop = false;
    const promise = recordUserSample(
      FAKE_CONNECTION,
      'userErr',
      { targetVoicedMs: 10_000, maxWallMs: 5_000, roundSilenceMs: 5_000, shouldStop: () => stop },
      {
        subscribe: () => {
          const o = fakeSubscribe();
          opuses.push(o);
          return o;
        },
        makeDecoder: () => {
          const d = fakePassthroughDecoder();
          decoders.push(d);
          return d;
        },
      },
    );
    // Let the 1st round set up; force an error ON THE DECODER SIDE (not via stopBoth) and
    // end the loop before the 200ms poll — isolates the `finish` path (end/close/error).
    await new Promise((r) => setTimeout(r, 60));
    const firstOpus = opuses[0];
    stop = true; // prevents a new round after the current one resolves
    decoders[0].emit('error', new Error('pacote opus corrompido'));
    await promise;
    // Without the fix, `finish` did not destroy the opus → the receiver subscription leaked.
    expect(firstOpus.destroyed).toBe(true);
  }, 5_000);

  it('a fully silent round does not get stuck — the round watchdog cuts it and retries', async () => {
    const opus = fakeSubscribe(); // never receives any push() — absolute silence
    const start = Date.now();
    const result = await recordUserSample(
      FAKE_CONNECTION,
      'user3',
      { targetVoicedMs: 10_000, maxWallMs: 300, roundSilenceMs: 60 },
      { subscribe: () => opus, makeDecoder: fakePassthroughDecoder },
    );
    const elapsed = Date.now() - start;

    expect(result.voicedMs).toBe(0);
    // maxWallMs=300 is the ceiling; if the round watchdog (60ms) did not cut the stuck
    // round, this would only resolve when vitest gave up (well above 1s).
    expect(elapsed).toBeLessThan(1500);
  }, 5_000);
});
