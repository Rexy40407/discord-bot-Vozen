import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock minimo de @discordjs/voice — o /redeem nao liga a voz, mas o modulo importa-o.
vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: () => ({}),
  getVoiceConnection: () => undefined,
}));

import { handleInteraction } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';
import { initDb } from '../src/store/db';
import { createRedeemCode, isGuildPremium } from '../src/store/premium';
import type Database from 'better-sqlite3';

const GUILD = 'g-redeem-test';

function makeDeps(db: Database.Database): BotDeps {
  return {
    client: { user: { id: 'bot-1' } },
    players: new Map(),
    db,
    config: {},
    availableModels: [],
  } as unknown as BotDeps;
}

/** Interação falsa do /redeem. `manage` = tem Gerir Servidor? */
function makeRedeemInteraction(code: string, manage: boolean) {
  const replies: string[] = [];
  return {
    commandName: 'redeem',
    guildId: GUILD,
    replies,
    replied: false,
    deferred: false,
    isRepliable: () => true,
    user: { id: 'u-1' },
    member: { permissions: { has: () => manage } },
    reply: async (o: { content: string }) => {
      replies.push(o.content);
    },
    options: {
      getSubcommand: () => '',
      getSubcommandGroup: () => null,
      getString: (name: string) => (name === 'code' ? code : ''),
    },
  };
}

describe('/redeem — SEC-02: código de servidor exige Gerir Servidor', () => {
  let db: Database.Database;
  const now = 1_000_000;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('código de GUILD + membro SEM Gerir Servidor -> recusa e NÃO consome', async () => {
    createRedeemCode(db, 'VOZEN-GUILD-1', 'guild', 30, now);
    const i = makeRedeemInteraction('VOZEN-GUILD-1', false);
    await handleInteraction(i as any, makeDeps(db));
    // mensagem de "precisa de Gerir Servidor"
    expect(i.replies.join('\n')).toMatch(/Manage Server|Gerir Servidor/i);
    // NÃO concedeu premium à guild...
    expect(isGuildPremium(db, GUILD, now + 1)).toBe(false);
    // ...e o código continua por usar: um admin ainda o resgata.
    const admin = makeRedeemInteraction('VOZEN-GUILD-1', true);
    await handleInteraction(admin as any, makeDeps(db));
    expect(isGuildPremium(db, GUILD, now + 1)).toBe(true);
  });

  it('código de GUILD + membro COM Gerir Servidor -> resgata com sucesso', async () => {
    createRedeemCode(db, 'VOZEN-GUILD-2', 'guild', 30, now);
    const i = makeRedeemInteraction('VOZEN-GUILD-2', true);
    await handleInteraction(i as any, makeDeps(db));
    expect(isGuildPremium(db, GUILD, now + 1)).toBe(true);
    expect(i.replies.join('\n')).not.toMatch(/Manage Server|Gerir Servidor/i);
  });

  it('código de USER (Plus) + membro SEM Gerir Servidor -> resgata (fica aberto a todos)', async () => {
    createRedeemCode(db, 'VOZEN-USER-1', 'user', 30, now);
    const i = makeRedeemInteraction('VOZEN-USER-1', false);
    await handleInteraction(i as any, makeDeps(db));
    // não bloqueia: códigos pessoais continuam abertos.
    expect(i.replies.join('\n')).not.toMatch(/Manage Server|Gerir Servidor/i);
  });

  it('código inexistente + membro SEM Gerir Servidor -> caminho normal de inválido', async () => {
    const i = makeRedeemInteraction('VOZEN-NOPE', false);
    await handleInteraction(i as any, makeDeps(db));
    // o peek devolveu null (não é 'guild'), por isso o gate não dispara: cai no invalid.
    expect(i.replies.join('\n')).not.toMatch(/Manage Server|Gerir Servidor/i);
    expect(i.replies.length).toBeGreaterThan(0);
  });
});
