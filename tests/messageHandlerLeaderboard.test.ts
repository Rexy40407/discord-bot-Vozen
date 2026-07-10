import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { handleMessage } from '../src/commands/messageHandler';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { setGuildConfig } from '../src/store/guildConfig';
import { bumpTalk } from '../src/store/talkStats';

const GUILD = 'g-lb';
const CHAN = 'chan-tts';
const USER = 'user-1';
const AVAILABLE = ['en_US-amy-medium', 'pt_PT-tugao-medium'];

function makeDeps(
  db: Database.Database,
  say: ReturnType<typeof vi.fn>,
  opts: { record: boolean; lbSend: ReturnType<typeof vi.fn> },
): BotDeps {
  const players = new Map<string, unknown>();
  players.set(GUILD, { say });
  const ttsChannel = { send: opts.lbSend };
  return {
    client: {
      user: { id: 'bot-1' },
      users: { cache: { get: () => undefined } },
      channels: { cache: { get: (id: string) => (id === CHAN ? ttsChannel : undefined) } },
    },
    db,
    players,
    limiters: new Map(),
    availableModels: AVAILABLE,
    config: { defaultVoice: 'de_DE-thorsten-medium', defaultSpeed: 1.0, messageLeadMs: 0 },
    leaderboardPoster: { record: vi.fn().mockReturnValue(opts.record) },
  } as unknown as BotDeps;
}

function makeMsg(): any {
  return {
    author: { bot: false, id: USER, username: 'Ana' },
    guild: {
      members: { cache: { get: () => undefined } },
      channels: { cache: { get: () => undefined } },
    },
    guildId: GUILD,
    channelId: CHAN,
    channel: { send: vi.fn().mockResolvedValue(undefined) }, // canal da msg (streak); irrelevante aqui
    content: 'ola malta tudo bem por aqui hoje neste servidor',
    member: { displayName: 'Ana', roles: { cache: { has: () => false } } },
    mentions: { has: () => false, repliedUser: null },
    reference: null,
  };
}

describe('handleMessage — leaderboard automático (F2)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
    setGuildConfig(db, GUILD, { autoread: true, ttsChannelId: CHAN, defaultVoice: '' });
    // Semeia tagarelas para o getTopSpeakers devolver linhas.
    bumpTalk(db, GUILD, 'top-user', new Date());
  });
  afterEach(() => {
    db.close();
  });

  it('poster decide postar -> envia o leaderboard no canal do /setup, SEM pingar', async () => {
    const lbSend = vi.fn().mockResolvedValue(undefined);
    const say = vi.fn().mockResolvedValue(true);
    await handleMessage(makeMsg(), makeDeps(db, say, { record: true, lbSend }));
    expect(say).toHaveBeenCalledTimes(1);
    expect(lbSend).toHaveBeenCalledTimes(1);
    const payload = lbSend.mock.calls[0][0];
    expect(String(payload.content)).toContain('Top talkers');
    expect(payload.allowedMentions).toEqual({ parse: [] }); // não pinga ninguém
  });

  it('poster decide NÃO postar -> não envia nada', async () => {
    const lbSend = vi.fn().mockResolvedValue(undefined);
    const say = vi.fn().mockResolvedValue(true);
    await handleMessage(makeMsg(), makeDeps(db, say, { record: false, lbSend }));
    expect(say).toHaveBeenCalledTimes(1);
    expect(lbSend).not.toHaveBeenCalled();
  });

  it('fila cheia (say false) -> não conta nem posta (record nem é chamado)', async () => {
    const lbSend = vi.fn().mockResolvedValue(undefined);
    const say = vi.fn().mockResolvedValue(false);
    const deps = makeDeps(db, say, { record: true, lbSend });
    await handleMessage(makeMsg(), deps);
    expect(lbSend).not.toHaveBeenCalled();
    expect((deps.leaderboardPoster as any).record).not.toHaveBeenCalled();
  });
});
