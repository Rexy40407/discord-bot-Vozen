import { describe, expect, it } from 'vitest';
import {
  admitDiscordAudioAttachment,
  withinAttachmentDuration,
} from '../src/voice/attachmentTranscription';

describe('attachment transcription admission', () => {
  const valid = {
    url: 'https://cdn.discordapp.com/attachments/1/2/audio.ogg',
    contentType: 'audio/ogg',
    size: 10,
  };

  it('accepts a bounded Discord CDN audio attachment', () => {
    expect(admitDiscordAudioAttachment(valid, 20).ok).toBe(true);
  });

  it('rejects arbitrary host, unsupported content type and oversized input before download', () => {
    expect(
      admitDiscordAudioAttachment({ ...valid, url: 'https://example.com/audio.ogg' }, 20),
    ).toMatchObject({ ok: false, reason: 'host' });
    expect(admitDiscordAudioAttachment({ ...valid, contentType: 'text/plain' }, 20)).toMatchObject({
      ok: false,
      reason: 'type',
    });
    expect(admitDiscordAudioAttachment({ ...valid, size: 21 }, 20)).toMatchObject({
      ok: false,
      reason: 'size',
    });
  });

  it('keeps duration validation local and finite', () => {
    expect(withinAttachmentDuration(30, 30)).toBe(true);
    expect(withinAttachmentDuration(31, 30)).toBe(false);
    expect(withinAttachmentDuration(Number.NaN, 30)).toBe(false);
  });
});
