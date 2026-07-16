// src/voice/exclusivity.ts — who currently owns the bot's "ears" in a guild.
//
// The bot has ONE microphone per guild, and two features fight over it:
//   - /transcribe holds `selfDeaf:false` for the WHOLE session (it hears until stopped);
//   - /voice clone record un-deafens for its window and ALWAYS re-deafens in its finally
//     (privacy by default — an invariant we must not weaken to fix the conflict).
// Whichever finishes LAST wins. So a clone recording started during a live transcription
// deafens the bot when it ends, while the session keeps running and believes it is still
// listening: the paid STT feature dies silently until someone runs /transcribe stop. The
// reverse order fails the same way. On top of that, both call
// `connection.receiver.subscribe(userId)`, which returns the SAME shared stream for an
// already-subscribed user — so overlapping captures corrupt each other too.
//
// This module is a leaf on purpose: handlers/voice.ts and handlers/transcribe.ts both
// import it, so neither has to import the other (which would be a cycle).
//
// Only the CLONE side lives here. The transcription side is already tracked by
// `activeSessions`/`startingGuilds` in the transcribe handler, which exports
// `isTranscribing()` — duplicating that state here would risk the two diverging.

/**
 * Guilds with a clone recording in flight, REFCOUNTED: two people can legitimately be
 * recorded in the same call (the per-target guard allows it), and if the first to finish
 * cleared the flag, a /transcribe start would be admitted while the second recording is
 * still live — and that recording's finally would deafen the new session. The count only
 * reaches zero when the last recording releases.
 */
const cloneRecordingsByGuild = new Map<string, number>();

/** True while at least one clone recording holds the mic in this guild. */
export function isCloneRecording(guildId: string): boolean {
  return (cloneRecordingsByGuild.get(guildId) ?? 0) > 0;
}

/** Registers a clone recording. ALWAYS pair with `clearCloneRecording` in a finally. */
export function markCloneRecording(guildId: string): void {
  cloneRecordingsByGuild.set(guildId, (cloneRecordingsByGuild.get(guildId) ?? 0) + 1);
}

/**
 * Releases one clone recording. Safe to call for a guild that was never marked (a finally
 * must never throw), and never lets the count go negative.
 */
export function clearCloneRecording(guildId: string): void {
  const n = cloneRecordingsByGuild.get(guildId);
  if (n === undefined) return;
  if (n <= 1) cloneRecordingsByGuild.delete(guildId);
  else cloneRecordingsByGuild.set(guildId, n - 1);
}

/** Test-only: the registry is module state, so each test needs a clean slate. */
export function resetVoiceExclusivityForTests(): void {
  cloneRecordingsByGuild.clear();
}
