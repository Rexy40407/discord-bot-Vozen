// src/tts/prosody.ts — synthetic QUESTION INTONATION (make the "?" sound like a question).
//
// WHY: the pitch rise at the end of a question you hear in some languages (e.g.
// Spanish) is Google's NATIVE voice, not a feature — and it varies by language (Google's
// PT/EN sound flat). To give the SAME question intonation in ALL languages and ALL
// engines, we apply it ourselves: we take the ALREADY synthesized WAV and RAISE the pitch
// only at the END (the "tail" of the speech), which is the universal acoustic signature of
// a question.
//
// HOW: ffmpeg CORE filters (asetrate+aresample+atempo — the same as the deep/chipmunk
// effects; no rubberband, which may not be compiled into ffmpeg-static).
// We cut the last ~QUESTION_TAIL_MS in JS (the WAV is always 22050/mono/16-bit — the
// canonical format of gTTS and Piper), pitch ONLY that piece, and concatenate
// [body + high-pitched tail].
//
// DECORATOR engine (same pattern as EffectEngine) with its own cache (namespace 'q') and
// FAIL-SAFE: any error returns the CLEAN voice — NEVER throws (a synth that throws makes
// the player SKIP the speech => silence). Only runs when the speech ENDS in `?` (the `?`
// aligns with the audio tail). Engines that don't produce 22050/mono/16 (e.g. Kokoro
// at 24k) fall into the fail-safe (splitTailWav returns null) and get no intonation — without crashing.

import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import type { SynthRequest, TTSEngine } from './engine';
import { AudioCache, cacheKey } from './cache';
import { applyEffect, type ApplyEffectDeps } from './effects';
import { parseWav, buildWav, concatWavs } from './wavConcat';
import { rmDirSafe } from './cleanupDir';
import { log } from '../logging/logger';

// Canonical format (gTTS/Piper). The split assumes it; splitTailWav validates it and bails if it doesn't match.
const SR = 22050;
const CHANNELS = 1;
const BITS = 16;
const BLOCK_ALIGN = (CHANNELS * BITS) / 8; // 2 bytes per sample-frame (mono 16-bit)

// TUNABLE: how much of the END gets the rise (ms) and how HIGH it goes (pitch multiplier).
// 500 ms ~= the last word/syllable; 1.10 = +10% pitch. Higher sounds "chipmunk" in the
// tail; lower goes unnoticed. If it sounds artificial, this is where to tune it.
const QUESTION_TAIL_MS = 500;
const QUESTION_PITCH = 1.1;

// asetrate speeds up+raises pitch; aresample returns to 22050; atempo=1/pitch restores the
// DURATION without lowering the pitch. Result: same length, higher pitch (same mechanic as deep/chipmunk).
export const QUESTION_FILTER = `asetrate=${SR}*${QUESTION_PITCH},aresample=${SR},atempo=${(
  1 / QUESTION_PITCH
).toFixed(4)}`;

/** Does the speech END in a question? (`?` at the end, tolerating quotes/parentheses/spaces after). PURE. */
export function isQuestion(text: string): boolean {
  return /\?["'”»)\]\s]*$/u.test(text);
}

/**
 * Splits the WAV into [body, tail] where the tail is the last `tailMs` ms, each already as
 * a canonical WAV. Returns `null` if the input is not 22050/mono/16-bit PCM (e.g. Kokoro at 24k)
 * — the caller then falls back to the clean voice. Cut aligned to the sample-frame. PURE.
 */
export function splitTailWav(wav: Buffer, tailMs: number): { head: Buffer; tail: Buffer } | null {
  let parsed;
  try {
    parsed = parseWav(wav, 0);
  } catch {
    return null; // not a valid RIFF WAV
  }
  if (
    parsed.audioFormat !== 1 ||
    parsed.sampleRate !== SR ||
    parsed.channels !== CHANNELS ||
    parsed.bits !== BITS
  ) {
    return null; // unexpected format -> no intonation (fail-safe upstream)
  }
  const data = parsed.data;
  const tailFrames = Math.round((tailMs / 1000) * SR);
  const tailBytes = Math.min(data.length, tailFrames * BLOCK_ALIGN);
  const splitAt = data.length - tailBytes;
  return {
    head: buildWav(data.subarray(0, splitAt)), // empty when the speech is all "tail" (short)
    tail: buildWav(data.subarray(splitAt)),
  };
}

/**
 * Decorator engine that gives QUESTION INTONATION to speeches ending in `?`: raises the pitch
 * at the end via ffmpeg, with its own cache (namespace 'q', keyed by cacheKey(req)+'_q' — like
 * EffectEngine). Speeches without `?` pass through intact. Any error -> CLEAN voice (never throws).
 */
export class ProsodyEngine implements TTSEngine {
  constructor(
    private readonly inner: TTSEngine,
    private readonly cache: AudioCache,
    private readonly deps: ApplyEffectDeps = {},
  ) {}

  async synth(req: SynthRequest): Promise<string> {
    const base = await this.inner.synth(req);
    if (!isQuestion(req.text)) return base;

    const key = `${cacheKey(req)}_q`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    let workDir: string | null = null;
    let pitchedDir: string | null = null;
    try {
      const split = splitTailWav(readFileSync(base), QUESTION_TAIL_MS);
      if (!split) return base; // unexpected format -> clean voice

      workDir = mkdtempSync(join(tmpdir(), 'vozen-q-'));
      const tailPath = join(workDir, 'tail.wav');
      writeFileSync(tailPath, split.tail);

      const pitchedPath = await applyEffect(tailPath, QUESTION_FILTER, this.deps);
      pitchedDir = dirname(pitchedPath);
      const out = concatWavs([split.head, readFileSync(pitchedPath)], { silenceMs: 0 });

      const outPath = join(workDir, 'out.wav');
      writeFileSync(outPath, out);
      return this.cache.put(key, outPath);
    } catch (err) {
      log.warn('[prosody] question intonation failed; using clean voice:', err);
      return base;
    } finally {
      // applyEffect does NOT clean up its dir on success (the caller copies and cleans up);
      // cache.put already copied out.wav from the workDir, so we can clean up both.
      if (pitchedDir) rmDirSafe(pitchedDir);
      if (workDir) rmDirSafe(workDir);
    }
  }
}
