// VOLUME EMPHASIS — "speak louder when there's ! or UPPERCASE".
//
// WHY HERE AND NOT IN THE ENGINE: neither the free gTTS (translate_tts endpoint, plain
// text only — ignores SSML/prosody) nor Piper expose punctuation-based prosody control.
// The "expressive" intonation heard in Spanish is Google's native voice, not a feature —
// and it varies by language (PT sounds flat). To give CONSISTENT emphasis across ALL
// languages and ALL engines, we apply a VOLUME gain to the ALREADY-synthesized audio,
// at playback (AudioResource inlineVolume in the player).
//
// It's "louder", not "more expressive voice" — that's what the user asked for. The gain is
// computed over the ORIGINAL text (with uppercase and `!`), before gTTS passes it through
// deCapsForGoogle (which lowercases uppercase just so the engine doesn't spell out acronyms).

// "Shout" detection: a run of 2+ uppercase letters (e.g. "STOP", "HELP"). NOT global
// (/g is stateful in .test() via lastIndex — reusing it would share state and give
// wrong results across calls). \p{M} catches combining diacritics (ÁÁ).
const RE_ALLCAPS_RUN = /\p{Lu}[\p{Lu}\p{M}]+/u;

// Amplitude gains (linear multipliers). The Piper/gTTS WAV doesn't come at maximum,
// so there's headroom; we raise them (from 1.22/1.4) so the "shout" is CLEARER — the
// request was for it to really be noticeable. Above this the risk of clipping/distortion
// grows fast on the strongest syllables, so we stop here. TUNABLE: if it sounds distorted,
// lower it; if it's too little, the next step is to give it pitch (ffmpeg), not more volume.
const GAIN_NONE = 1;
const GAIN_SOFT = 1.3; // one emphasis signal (one `!` or one uppercase word)
const GAIN_STRONG = 1.5; // strong emphasis (!! or more, or uppercase + `!`)

/**
 * Volume gain for a speech utterance, from its text. 1.0 = normal (no gain).
 * >1.0 = louder. Pure and deterministic (testable in isolation). Engine-agnostic:
 * the player applies it at playback, so it works regardless of the TTS engine.
 */
export function emphasisGain(text: string): number {
  if (!text) return GAIN_NONE;
  const bangs = (text.match(/!/g) ?? []).length;
  const shout = RE_ALLCAPS_RUN.test(text);
  if (bangs === 0 && !shout) return GAIN_NONE;
  // Strong: many `!`, or shouting AND exclaiming at the same time.
  if (bangs >= 2 || (shout && bangs >= 1)) return GAIN_STRONG;
  return GAIN_SOFT;
}
