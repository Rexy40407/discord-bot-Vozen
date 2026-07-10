import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { handleMessage } from '../src/commands/messageHandler';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { setGuildConfig } from '../src/store/guildConfig';
import { bumpTalk } from '../src/store/talkStats';

const GUILD = 'g-streak';
const CHAN = 'chan-1';
const USER = 'user-1';
const AVAILABLE = ['en_US-amy-medium', 'pt_PT-tugao-medium'];

// O handler chama bumpTalk(new Date()) — não injetável. Por isso semeamos o estado
// RELATIVO ao AGORA real: uma Date de ONTEM cria a linha com last_date=ontem, streak 1;
// a mensagem de hoje leva o streak a 2 e firstOfDay=true -> dispara o aviso "Dia 2".
function yesterday(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
}

function makeDeps(db: Database.Database, say: ReturnType<typeof vi.fn>): BotDeps {
  const players = new Map<string, unknown>();
  players.set(GUILD, { say });
  return {
    client: { user: { id: 'bot-1' }, users: { cache: { get: () => undefined } } },
    db,
    players,
    limiters: new Map(),
    availableModels: AVAILABLE,
    config: { defaultVoice: 'de_DE-thorsten-medium', defaultSpeed: 1.0, messageLeadMs: 0 },
  } as unknown as BotDeps;
}

function makeMsg(send: ReturnType<typeof vi.fn>): any {
  return {
    author: { bot: false, id: USER, username: 'Ana' },
    guild: {
      members: { cache: { get: () => undefined } },
      channels: { cache: { get: () => undefined } },
    },
    guildId: GUILD,
    channelId: CHAN,
    channel: { send },
    content: 'ola malta tudo bem por aqui hoje',
    member: { displayName: 'Ana', roles: { cache: { has: () => false } } },
    mentions: { has: () => false, repliedUser: null },
    reference: null,
  };
}

describe('handleMessage — aviso de streak 🔥 (F1)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
    setGuildConfig(db, GUILD, { autoread: true, ttsChannelId: CHAN, defaultVoice: '' });
  });
  afterEach(() => {
    db.close();
  });

  it('2.º dia seguido -> envia o aviso "Dia 2" no canal (com a menção)', async () => {
    bumpTalk(db, GUILD, USER, yesterday()); // semeia streak 1 de ontem
    const send = vi.fn().mockResolvedValue(undefined);
    const say = vi.fn().mockResolvedValue(true); // enfileirada
    await handleMessage(makeMsg(send), makeDeps(db, say));
    expect(say).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][0];
    expect(String(payload.content)).toContain(`<@${USER}>`);
    expect(String(payload.content)).toContain('2');
    expect(payload.allowedMentions).toEqual({ parse: [] }); // menção visível mas NÃO pinga
  });

  it('primeira mensagem de sempre (Dia 1) -> NÃO envia aviso (só do Dia 2)', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const say = vi.fn().mockResolvedValue(true);
    await handleMessage(makeMsg(send), makeDeps(db, say));
    expect(say).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('2.ª mensagem do MESMO dia -> NÃO reenvia (só na 1.ª do dia)', async () => {
    bumpTalk(db, GUILD, USER, yesterday());
    const send = vi.fn().mockResolvedValue(undefined);
    const say = vi.fn().mockResolvedValue(true);
    const deps = makeDeps(db, say);
    await handleMessage(makeMsg(send), deps); // Dia 2 -> avisa
    await handleMessage(makeMsg(send), deps); // mesmo dia -> não avisa
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('toggle OFF (/config streaks off) -> não envia mesmo com streak', async () => {
    bumpTalk(db, GUILD, USER, yesterday());
    setGuildConfig(db, GUILD, { streakAnnounce: false });
    const send = vi.fn().mockResolvedValue(undefined);
    const say = vi.fn().mockResolvedValue(true);
    await handleMessage(makeMsg(send), makeDeps(db, say));
    expect(say).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('fila cheia (say -> false) -> não envia o aviso', async () => {
    bumpTalk(db, GUILD, USER, yesterday());
    const send = vi.fn().mockResolvedValue(undefined);
    const say = vi.fn().mockResolvedValue(false); // não enfileirada
    await handleMessage(makeMsg(send), makeDeps(db, say));
    expect(send).not.toHaveBeenCalled();
  });
});
