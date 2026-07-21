import { describe, expect, it } from 'vitest';
import { resolveSttCaptureTuning } from '../src/voice/sttTuning';

describe('resolveSttCaptureTuning', () => {
  it('uses defaults tuned for natural pauses and short words', () => {
    expect(resolveSttCaptureTuning({})).toEqual({
      collectorOpts: {
        bytesPerMs: 192,
        rmsThreshold: 220,
        silenceGapMs: 1300,
        minUtteranceMs: 180,
        maxUtteranceMs: 30000,
        preRollMs: 240,
      },
      receiverEndSilenceMs: 1500,
    });
  });

  it('accepts safe overrides and keeps the receiver above the collector gap', () => {
    const tuning = resolveSttCaptureTuning({
      STT_SILENCE_GAP_MS: '1800',
      STT_RECEIVER_END_SILENCE_MS: '1000',
      STT_RMS_THRESHOLD: '180',
      STT_MIN_SPEECH_MS: '120',
      STT_PRE_ROLL_MS: '300',
      STT_MAX_UTTERANCE_MS: '45000',
    });
    expect(tuning.collectorOpts).toMatchObject({
      rmsThreshold: 180,
      silenceGapMs: 1800,
      minUtteranceMs: 120,
      preRollMs: 300,
      maxUtteranceMs: 45000,
    });
    expect(tuning.receiverEndSilenceMs).toBe(2000);
  });

  it('rejects malformed and dangerous values', () => {
    const tuning = resolveSttCaptureTuning({
      STT_SILENCE_GAP_MS: '0',
      STT_RMS_THRESHOLD: 'not-a-number',
      STT_MIN_SPEECH_MS: '2.5',
      STT_PRE_ROLL_MS: '-1',
      STT_MAX_UTTERANCE_MS: '999999',
    });
    expect(tuning).toEqual(resolveSttCaptureTuning({}));
  });
});
