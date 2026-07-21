import type { UtteranceOpts } from './utteranceCollector';

export interface SttCaptureTuning {
  collectorOpts: Required<UtteranceOpts>;
  /** Discord receiver closes after this much silence; kept above the collector gap. */
  receiverEndSilenceMs: number;
}

function boundedInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/**
 * Conservative defaults for short, real Discord speech. Every value remains tunable on the
 * VPS without a code change, while invalid/extreme values fail back to the calibrated default.
 */
export function resolveSttCaptureTuning(env: NodeJS.ProcessEnv = process.env): SttCaptureTuning {
  const silenceGapMs = boundedInt(env, 'STT_SILENCE_GAP_MS', 1300, 400, 5000);
  const requestedReceiverEnd = boundedInt(env, 'STT_RECEIVER_END_SILENCE_MS', 1500, 500, 6000);
  return {
    collectorOpts: {
      bytesPerMs: 192,
      rmsThreshold: boundedInt(env, 'STT_RMS_THRESHOLD', 220, 50, 5000),
      silenceGapMs,
      minUtteranceMs: boundedInt(env, 'STT_MIN_SPEECH_MS', 180, 80, 2000),
      maxUtteranceMs: boundedInt(env, 'STT_MAX_UTTERANCE_MS', 30000, 5000, 60000),
      preRollMs: boundedInt(env, 'STT_PRE_ROLL_MS', 240, 0, 1000),
    },
    // The receiver must outlive the collector long enough to emit a gap-closed utterance.
    receiverEndSilenceMs: Math.max(requestedReceiverEnd, silenceGapMs + 200),
  };
}
