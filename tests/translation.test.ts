import { describe, expect, it, vi } from 'vitest';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { initDb } from '../src/store/db';
import { setGuildConfig } from '../src/store/guildConfig';
import {
  addTranslationMapping,
  getTranslationMapping,
  refundTranslationChars,
  reserveTranslationChars,
} from '../src/store/translation';
import {
  minimiseTranslationText,
  TRANSLATION_MARKER,
  handleTranslationMessage,
} from '../src/translation/messageListener';
import {
  AzureTranslationProvider,
  DisabledTranslationProvider,
  parseTranslationProviderConfig,
  TranslationError,
} from '../src/translation/provider';
import type { BotDeps } from '../src/bot/deps';
import { canMapChannel } from '../src/commands/handlers/translation';

const GUILD = 'guild-1';
const SOURCE = 'source-1';
const DESTINATION = 'destination-1';
const USER = 'user-1';
const BOT = 'bot-1';

function db() {
  return initDb(':memory:');
}

describe('translation provider privacy boundary', () => {
  it('is disabled unless complete HTTPS Azure settings are explicitly selected', async () => {
    expect(parseTranslationProviderConfig({})).toEqual({ kind: 'disabled' });
    expect(parseTranslationProviderConfig({ TRANSLATION_PROVIDER: 'azure' })).toEqual({
      kind: 'disabled',
    });
    expect(
      parseTranslationProviderConfig({
        TRANSLATION_PROVIDER: 'azure',
        TRANSLATION_AZURE_ENDPOINT: 'http://insecure.example',
        TRANSLATION_AZURE_KEY: 'key',
      }),
    ).toEqual({ kind: 'disabled' });
    await expect(new DisabledTranslationProvider().translate()).rejects.toMatchObject({
      code: 'disabled',
    });
  });

  it('sends Azure only the current text and target locale', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ translations: [{ text: 'olá' }] }],
    });
    const provider = new AzureTranslationProvider('https://translator.example', 'secret', fetch);
    await expect(provider.translate({ text: 'hello', targetLocale: 'pt' })).resolves.toBe('olá');
    expect(fetch).toHaveBeenCalledWith(
      'https://translator.example/translate?api-version=3.0&to=pt',
      expect.objectContaining({ body: JSON.stringify([{ Text: 'hello' }]) }),
    );
  });

  it('strips Discord mentions, URLs and its own marker before provider admission', () => {
    expect(
      minimiseTranslationText(
        `<@${USER}> <#${SOURCE}> @everyone https://discord.com/channels/1/2/3?token=nope hi ${TRANSLATION_MARKER}`,
      ),
    ).toBe('[member] [channel] [mention] [link] hi');
  });
});

describe('translation persistence and quota', () => {
  it('requires GuildText plus View at the source, and Send only at the destination', () => {
    const me = { id: BOT };
    const all = { has: () => true };
    const noSend = { has: (permission: bigint) => permission !== PermissionFlagsBits.SendMessages };
    expect(
      canMapChannel({ type: ChannelType.GuildText, permissionsFor: () => all }, me, true),
    ).toBe(true);
    expect(
      canMapChannel({ type: ChannelType.GuildText, permissionsFor: () => noSend }, me, true),
    ).toBe(false);
    expect(
      canMapChannel({ type: ChannelType.GuildText, permissionsFor: () => noSend }, me, false),
    ).toBe(true);
    expect(
      canMapChannel({ type: ChannelType.GuildVoice, permissionsFor: () => all }, me, true),
    ).toBe(false);
  });

  it('rejects self-targeting and cycles, but stores no message text', () => {
    const database = db();
    expect(() =>
      addTranslationMapping(database, {
        guildId: GUILD,
        sourceChannelId: SOURCE,
        destinationChannelId: SOURCE,
        targetLocale: 'pt',
      }),
    ).toThrow(/Invalid/);
    addTranslationMapping(database, {
      guildId: GUILD,
      sourceChannelId: SOURCE,
      destinationChannelId: DESTINATION,
      targetLocale: 'pt',
    });
    expect(() =>
      addTranslationMapping(database, {
        guildId: GUILD,
        sourceChannelId: DESTINATION,
        destinationChannelId: SOURCE,
        targetLocale: 'en',
      }),
    ).toThrow(/cycle/);
    expect(getTranslationMapping(database, GUILD, SOURCE)).toMatchObject({ targetLocale: 'pt' });
    const columns = database.pragma('table_info(translation_mapping)') as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).not.toContain('text');
  });

  it('atomically enforces guild and per-user quotas and refunds only failures', () => {
    const database = db();
    const first = reserveTranslationChars(database, {
      guildId: GUILD,
      userId: USER,
      chars: 4,
      guildLimit: 5,
      userLimit: 4,
      day: '2026-07-22',
    });
    expect(first).toMatchObject({ ok: true });
    expect(
      reserveTranslationChars(database, {
        guildId: GUILD,
        userId: USER,
        chars: 1,
        guildLimit: 5,
        userLimit: 4,
        day: '2026-07-22',
      }),
    ).toEqual({ ok: false, reason: 'user_quota' });
    refundTranslationChars(database, first as Extract<typeof first, { ok: true }>, GUILD, USER);
    expect(
      reserveTranslationChars(database, {
        guildId: GUILD,
        userId: USER,
        chars: 5,
        guildLimit: 5,
        userLimit: 5,
        day: '2026-07-22',
      }),
    ).toMatchObject({ ok: true });
  });
});

function makeDeps(
  database: ReturnType<typeof initDb>,
  provider?: BotDeps['translationProvider'],
): BotDeps {
  return {
    db: database,
    translationProvider: provider,
    client: { user: { id: BOT } },
    players: new Map(),
    limiters: new Map(),
    availableModels: [],
    config: {},
  } as unknown as BotDeps;
}

function makeMessage(send: ReturnType<typeof vi.fn>, content = 'hello'): any {
  const can = { has: () => true };
  const source = { id: SOURCE, type: 0, permissionsFor: () => can };
  const destination = { id: DESTINATION, type: 0, permissionsFor: () => can, send };
  return {
    guildId: GUILD,
    guild: {
      channels: {
        cache: new Map([
          [SOURCE, source],
          [DESTINATION, destination],
        ]),
      },
    },
    channelId: SOURCE,
    content,
    author: { id: USER, bot: false },
    webhookId: null,
    react: vi.fn(),
  };
}

describe('translation message listener', () => {
  it('is default-off and never asks the provider to translate', async () => {
    const database = db();
    addTranslationMapping(database, {
      guildId: GUILD,
      sourceChannelId: SOURCE,
      destinationChannelId: DESTINATION,
      targetLocale: 'pt',
    });
    const translate = vi.fn();
    await handleTranslationMessage(
      makeMessage(vi.fn()),
      makeDeps(database, { kind: 'azure', enabled: true, translate }),
    );
    expect(translate).not.toHaveBeenCalled();
  });

  it('honours the guild-wide disabled switch before provider admission', async () => {
    const database = db();
    setGuildConfig(database, GUILD, { enabled: false, translationEnabled: true });
    addTranslationMapping(database, {
      guildId: GUILD,
      sourceChannelId: SOURCE,
      destinationChannelId: DESTINATION,
      targetLocale: 'pt',
    });
    const translate = vi.fn();
    await handleTranslationMessage(
      makeMessage(vi.fn(), 'hello'),
      makeDeps(database, { kind: 'azure', enabled: true, translate }),
    );
    expect(translate).not.toHaveBeenCalled();
  });

  it('translates a configured message without enqueuing speech and ignores bot/marker messages', async () => {
    const database = db();
    setGuildConfig(database, GUILD, {
      translationEnabled: true,
      translationDailyCharLimit: 100,
      translationPerUserDailyCharLimit: 100,
    });
    addTranslationMapping(database, {
      guildId: GUILD,
      sourceChannelId: SOURCE,
      destinationChannelId: DESTINATION,
      targetLocale: 'pt',
    });
    const send = vi.fn().mockResolvedValue(undefined);
    const translate = vi.fn().mockResolvedValue('olá');
    await handleTranslationMessage(
      makeMessage(send),
      makeDeps(database, { kind: 'azure', enabled: true, translate }),
    );
    expect(translate).toHaveBeenCalledWith({ text: 'hello', targetLocale: 'pt' });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining(TRANSLATION_MARKER) }),
    );
    const botMessage = makeMessage(send, `ignored ${TRANSLATION_MARKER}`);
    botMessage.author.bot = true;
    await handleTranslationMessage(
      botMessage,
      makeDeps(database, { kind: 'azure', enabled: true, translate }),
    );
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it('refunds a failed provider reservation without leaking a provider error to the channel', async () => {
    const database = db();
    setGuildConfig(database, GUILD, {
      translationEnabled: true,
      translationDailyCharLimit: 5,
      translationPerUserDailyCharLimit: 5,
    });
    addTranslationMapping(database, {
      guildId: GUILD,
      sourceChannelId: SOURCE,
      destinationChannelId: DESTINATION,
      targetLocale: 'pt',
    });
    const send = vi.fn();
    const translate = vi
      .fn()
      .mockRejectedValue(new TranslationError('transient', 'raw response should not leak'));
    await handleTranslationMessage(
      makeMessage(send, 'hello'),
      makeDeps(database, { kind: 'azure', enabled: true, translate }),
    );
    expect(send).not.toHaveBeenCalled();
    expect(
      reserveTranslationChars(database, {
        guildId: GUILD,
        userId: USER,
        chars: 5,
        guildLimit: 5,
        userLimit: 5,
        day: new Date().toISOString().slice(0, 10),
      }),
    ).toMatchObject({ ok: true });
  });
});
