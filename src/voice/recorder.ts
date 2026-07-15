// src/voice/recorder.ts
//
// Recording the user's OWN voice for the clone (/voice clone record). CONSENT-FIRST by
// design: we subscribe ONLY to the invoker's audio (receiver.subscribe(userId)),
// never the whole channel; the bot lives deafened (selfDeaf) and only the caller
// "uncovers" it during the explicit recording window, deafening again at the end.

import { EndBehaviorType, type VoiceConnection } from '@discordjs/voice';
import prism from 'prism-media';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import type { Readable, Duplex } from 'node:stream';
import ffmpegStatic from 'ffmpeg-static';
import { rmDirSafe } from '../tts/cleanupDir';

/** PCM s16le 48kHz stereo => 192 bytes per millisecond. */
const BYTES_PER_MS = (48000 * 2 * 2) / 1000;

/**
 * Accumulates only the frames WITH VOICE (RMS above the noise floor) until reaching the
 * target of spoken milliseconds. Pauses/breathing don't count — so "15s of sample" is
 * 15s of SPEECH, not of silence. PURE (fed with buffers), hence testable.
 */
/** Noise floor (RMS int16) above which a frame counts as SPEECH. ~350 ≈ −39 dBFS.
 * NOTE: was 500 (~−36 dBFS); lowered as a HYPOTHESIS for the clone sample coming out short —
 * normal speech (strong vowels) passed, but sentence tails / soft consonants / low-gain
 * mics fell below and didn't count. The proof is in the per-recording diagnostics
 * (framesSeen vs framesVoiced + RMS distribution) that the recorder returns. */
const DEFAULT_RMS_THRESHOLD = 350;

export class VoicedCollector {
  private chunks: Buffer[] = [];
  private voicedBytes = 0;
  /** Diagnostic: total frames seen and the RMS distribution (to confirm whether it's the
   *  gate eating the audio vs the user simply speaking too little). */
  framesSeen = 0;
  framesVoiced = 0;
  private readonly rmsSamples: number[] = [];

  constructor(
    private readonly targetVoicedMs: number,
    private readonly rmsThreshold: number = DEFAULT_RMS_THRESHOLD,
  ) {}

  /** Feeds a PCM frame; returns true when the target has been reached. */
  push(buf: Buffer): boolean {
    this.framesSeen++;
    const rms = this.rmsOf(buf);
    this.rmsSamples.push(rms);
    if (rms >= this.rmsThreshold) {
      this.chunks.push(buf);
      this.voicedBytes += buf.length;
      this.framesVoiced++;
    }
    return this.done;
  }

  get done(): boolean {
    return this.voicedBytes >= this.targetVoicedMs * BYTES_PER_MS;
  }

  get voicedMs(): number {
    return Math.round(this.voicedBytes / BYTES_PER_MS);
  }

  pcm(): Buffer {
    return Buffer.concat(this.chunks);
  }

  /** min/median/max of the RMS of the frames seen (0s if none were seen). */
  rmsStats(): { min: number; median: number; max: number } {
    if (this.rmsSamples.length === 0) return { min: 0, median: 0, max: 0 };
    const sorted = [...this.rmsSamples].sort((a, b) => a - b);
    return {
      min: Math.round(sorted[0]),
      median: Math.round(sorted[Math.floor(sorted.length / 2)]),
      max: Math.round(sorted[sorted.length - 1]),
    };
  }

  get threshold(): number {
    return this.rmsThreshold;
  }

  private rmsOf(buf: Buffer): number {
    const n = Math.floor(buf.length / 2);
    if (n === 0) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const s = buf.readInt16LE(i * 2);
      sum += s * s;
    }
    return Math.sqrt(sum / n);
  }
}

export interface RecordDiag {
  framesSeen: number;
  framesVoiced: number;
  rmsMin: number;
  rmsMedian: number;
  rmsMax: number;
  rounds: number;
  threshold: number;
}

export interface RecordResult {
  pcm: Buffer;
  voicedMs: number;
  /** Recording diagnostic — the caller logs it to confirm the cause of short samples. */
  diag: RecordDiag;
}

/** Injectable dependencies (tests): how to subscribe to the SSRC and how to build the decoder. */
export interface RecordDeps {
  subscribe?: (connection: VoiceConnection, userId: string) => Readable;
  makeDecoder?: () => Duplex;
}

function defaultSubscribe(connection: VoiceConnection, userId: string): Readable {
  return connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 800 },
  });
}

function defaultMakeDecoder(): Duplex {
  return new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 }) as unknown as Duplex;
}

/**
 * Records ONE user's voice from the voice connection: subscribes to their SSRC
 * (and only theirs), decodes opus->PCM 48k stereo and accumulates until `targetVoicedMs` of
 * speech or `maxWallMs` of wall clock. Discord closes the stream on each pause (DTX), so
 * we RE-subscribe in a loop until the target/time runs out. Never throws on silence —
 * returns what it captured (the caller decides if it's enough).
 */
export async function recordUserSample(
  connection: VoiceConnection,
  userId: string,
  opts: {
    targetVoicedMs?: number;
    maxWallMs?: number;
    shouldStop?: () => boolean;
    /** Watchdog for a round with no audio at all (testable; production uses the 5s default). */
    roundSilenceMs?: number;
    /** Notified with the accumulated SPEECH ms on each voiced frame (live feedback). */
    onProgress?: (voicedMs: number) => void;
  } = {},
  deps: RecordDeps = {},
): Promise<RecordResult> {
  const targetVoicedMs = opts.targetVoicedMs ?? 15_000;
  const maxWallMs = opts.maxWallMs ?? 45_000;
  const shouldStop = opts.shouldStop ?? (() => false);
  const roundSilenceMs = opts.roundSilenceMs ?? 5_000;
  const onProgress = opts.onProgress ?? ((): void => {});
  const subscribe = deps.subscribe ?? defaultSubscribe;
  const makeDecoder = deps.makeDecoder ?? defaultMakeDecoder;
  const collector = new VoicedCollector(targetVoicedMs);
  const deadline = Date.now() + maxWallMs;
  let rounds = 0;

  while (!collector.done && Date.now() < deadline && !shouldStop()) {
    rounds++;
    const gotAudio = await new Promise<boolean>((resolve) => {
      let received = false;
      const opus = subscribe(connection, userId);
      const decoder = makeDecoder();
      // CRITICAL: `stream.pipe()` does NOT propagate destroy() from source to
      // destination — it's low-level Readable→Writable, without stream.pipeline()'s
      // cleanup. If we only destroyed `opus`, the `decoder` would never emit 'end'/'close'
      // and the round's Promise would stay PENDING FOREVER (real bug: this is why neither
      // the "Stop" button nor the silence watchdog worked — the recording simply
      // wouldn't stop). So we ALWAYS destroy both together.
      const stopBoth = (): void => {
        opus.destroy();
        decoder.destroy();
      };
      // ROUND watchdog: if the user doesn't speak at all, AfterSilence never arms
      // (in some versions it only counts after the 1st packet) — it cuts the round after
      // `roundSilenceMs`. It also polls shouldStop (the "Stop" button) to close the
      // in-progress round ~200ms later.
      const roundTimer = setTimeout(stopBoth, roundSilenceMs);
      const stopPoll = setInterval(() => {
        if (shouldStop()) stopBoth();
      }, 200);
      opus.pipe(decoder);
      decoder.on('data', (chunk: Buffer) => {
        received = true;
        const done = collector.push(chunk);
        onProgress(collector.voicedMs); // live feedback (the caller throttles)
        if (done) stopBoth(); // target reached -> close now
      });
      const finish = (): void => {
        clearTimeout(roundTimer);
        clearInterval(stopPoll);
        decoder.removeAllListeners();
        // ALWAYS destroy the source: an error on the decoder side reaches here without
        // going through stopBoth, and without this the receiver subscription (opus) would
        // stay alive (leak). Idempotent — when `finish` comes from stopBoth, opus is already destroyed.
        opus.destroy();
        resolve(received);
      };
      decoder.once('end', finish);
      decoder.once('close', finish);
      decoder.once('error', finish);
      opus.once('error', stopBoth);
    });
    // Round without a single frame (user silent): wait a tiny bit before re-subscribing
    // to avoid a subscribe/destroy busy-loop.
    if (!gotAudio && !collector.done && !shouldStop()) await new Promise((r) => setTimeout(r, 400));
  }

  const rms = collector.rmsStats();
  return {
    pcm: collector.pcm(),
    voicedMs: collector.voicedMs,
    diag: {
      framesSeen: collector.framesSeen,
      framesVoiced: collector.framesVoiced,
      rmsMin: rms.min,
      rmsMedian: rms.median,
      rmsMax: rms.max,
      rounds,
      threshold: collector.threshold,
    },
  };
}

const FF_TIMEOUT_MS = 20_000;

export interface PcmToWavDeps {
  ffmpegPath?: string | null;
  spawnImpl?: typeof spawn;
}

/**
 * Converts the raw PCM (s16le 48k stereo) into a 24kHz mono WAV — the cloning engine's
 * reference format — and writes it to `outPath` (creates the directory). Same ffmpeg
 * runner pattern as the rest of the pipeline: temp dir, timeout+kill, best-effort cleanup.
 */
export function pcmToWavFile(
  pcm: Buffer,
  outPath: string,
  deps: PcmToWavDeps = {},
): Promise<string> {
  const ff = (deps.ffmpegPath ?? (ffmpegStatic as unknown as string | null)) as string | null;
  const spawnImpl = deps.spawnImpl ?? spawn;
  if (!ff) return Promise.reject(new Error('recorder: ffmpeg-static not found'));

  const workDir = mkdtempSync(join(tmpdir(), 'vozen-rec-'));
  const rawPath = join(workDir, 'in.raw');
  const wavPath = join(workDir, 'out.wav');
  try {
    writeFileSync(rawPath, pcm);
  } catch (err) {
    rmDirSafe(workDir);
    throw err;
  }
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    's16le',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-i',
    rawPath,
    '-ar',
    '24000',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    '-f',
    'wav',
    wavPath,
    '-y',
  ];

  return new Promise<string>((resolve, reject) => {
    const child = spawnImpl(ff, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // already dead
      }
      reject(new Error(`recorder: ffmpeg excedeu ${FF_TIMEOUT_MS}ms`));
      rmDirSafe(workDir);
    }, FF_TIMEOUT_MS);
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`recorder: falha ao iniciar ffmpeg: ${err.message}`));
      rmDirSafe(workDir);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`recorder: ffmpeg saiu com ${code}: ${stderr.trim()}`));
        rmDirSafe(workDir);
        return;
      }
      try {
        mkdirSync(dirname(outPath), { recursive: true });
        copyFileSync(wavPath, outPath);
        resolve(outPath);
      } catch (err) {
        reject(err as Error);
      } finally {
        rmDirSafe(workDir);
      }
    });
  });
}
