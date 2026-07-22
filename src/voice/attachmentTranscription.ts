/** Safe, IO-free admission gate for the future Discord-attachment transcription command. */
export interface DiscordAudioAttachment {
  url: string;
  contentType: string | null | undefined;
  size: number;
}

export type AttachmentAdmission =
  { ok: true; url: URL } | { ok: false; reason: 'host' | 'type' | 'size' | 'url' };

const DISCORD_CDN_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
const AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/webm',
]);

/**
 * No network request happens here. The command must use this before downloading, then enforce
 * an ffmpeg-derived duration cap with a timeout. Arbitrary URLs and browser/User-App contexts
 * are structurally excluded because the only accepted hosts are Discord's attachment CDNs.
 */
export function admitDiscordAudioAttachment(
  attachment: DiscordAudioAttachment,
  maxBytes: number,
): AttachmentAdmission {
  let url: URL;
  try {
    url = new URL(attachment.url);
  } catch {
    return { ok: false, reason: 'url' };
  }
  if (url.protocol !== 'https:' || !DISCORD_CDN_HOSTS.has(url.hostname.toLowerCase())) {
    return { ok: false, reason: 'host' };
  }
  const type = attachment.contentType?.split(';', 1)[0].trim().toLowerCase();
  if (!type || !AUDIO_TYPES.has(type)) return { ok: false, reason: 'type' };
  if (!Number.isSafeInteger(attachment.size) || attachment.size < 1 || attachment.size > maxBytes) {
    return { ok: false, reason: 'size' };
  }
  return { ok: true, url };
}

/** Kept separate from the CDN gate so a future local ffprobe adapter can be timeout-tested. */
export function withinAttachmentDuration(durationSeconds: number, maxSeconds: number): boolean {
  return Number.isFinite(durationSeconds) && durationSeconds > 0 && durationSeconds <= maxSeconds;
}
