import { describe, it, expect, beforeEach } from 'vitest';
import {
  isCloneRecording,
  markCloneRecording,
  clearCloneRecording,
  resetVoiceExclusivityForTests,
} from '../src/voice/exclusivity';
import { evaluateTranscribeStart, type TranscribeStartInput } from '../src/commands/transcribeGate';

// The bot has ONE microphone per guild. /transcribe holds selfDeaf:false for its whole
// session; /voice clone record un-deafens for its window and ALWAYS re-deafens in its
// finally (a privacy invariant that must not be weakened). Whoever finishes last wins —
// so a clone recording that ends during a live transcription silently deafens the bot
// while the session believes it is still listening. They must be mutually exclusive.
describe('voice exclusivity — clone recording registry', () => {
  beforeEach(() => resetVoiceExclusivityForTests());

  it('a guild starts with no clone recording', () => {
    expect(isCloneRecording('g1')).toBe(false);
  });

  it('mark/clear round-trips per guild', () => {
    markCloneRecording('g1');
    expect(isCloneRecording('g1')).toBe(true);
    expect(isCloneRecording('g2')).toBe(false); // scoped to the guild
    clearCloneRecording('g1');
    expect(isCloneRecording('g1')).toBe(false);
  });

  it('clearing a guild that was never marked is a no-op (safe in a finally)', () => {
    expect(() => clearCloneRecording('never')).not.toThrow();
    expect(isCloneRecording('never')).toBe(false);
  });

  it('concurrent recordings in the same guild: the LAST clear wins, so it is refcounted', () => {
    // Two people can be recorded in the same call (the per-target guard allows it). If the
    // first to finish cleared the guild flag, a /transcribe start would be let in while a
    // second recording is still live — and that recording's finally would deafen it.
    markCloneRecording('g1');
    markCloneRecording('g1');
    clearCloneRecording('g1');
    expect(isCloneRecording('g1')).toBe(true); // one recording still running
    clearCloneRecording('g1');
    expect(isCloneRecording('g1')).toBe(false);
  });
});

describe('evaluateTranscribeStart — refuses while a clone recording holds the mic', () => {
  const base: TranscribeStartInput = {
    canManage: true,
    isPremium: true,
    sidecarAvailable: true,
    botInVoice: true,
    alreadyRunning: false,
    atCapacity: false,
    cloneRecording: false,
  };

  it('ok when nothing else holds the mic', () => {
    expect(evaluateTranscribeStart(base)).toBe('ok');
  });

  it('a live clone recording blocks the start', () => {
    expect(evaluateTranscribeStart({ ...base, cloneRecording: true })).toBe('busyClone');
  });

  it('permission and entitlement still answer FIRST (do not leak "busy" to outsiders)', () => {
    expect(evaluateTranscribeStart({ ...base, cloneRecording: true, canManage: false })).toBe(
      'noManage',
    );
    expect(evaluateTranscribeStart({ ...base, cloneRecording: true, isPremium: false })).toBe(
      'notPremium',
    );
  });

  it('"already running here" stays more specific than the clone conflict', () => {
    expect(evaluateTranscribeStart({ ...base, cloneRecording: true, alreadyRunning: true })).toBe(
      'alreadyRunning',
    );
  });
});
