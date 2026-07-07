import { describe, it, expect, vi } from 'vitest';

vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: () => ({}),
  getVoiceConnection: () => undefined,
}));

import { handleInteraction, commandDefs, formatDuration } from '../src/commands/index';
import type { BotDeps } from '../src/bot/deps';

function makeInteraction(commandName: string) {
  const replies: string[] = [];
  return {
    commandName,
    guildId: 'g-1',
    user: { id: 'u-1' },
    locale: 'pt-BR',
    replies,
    replied: false,
    deferred: false,
    isRepliable: () => true,
    reply: async (o: {
      content?: string;
      embeds?: { data?: { description?: string } }[];
      flags?: number;
    }) => {
      // Regista texto OU a descrição do embed (o /botstats e /stats passaram a embeds).
      const fromEmbeds = (o.embeds ?? []).map((e) => e?.data?.description ?? '').join('\n');
      replies.push(o.content ?? fromEmbeds);
    },
  };
}

function makeDeps(servers: number, players: number): BotDeps {
  return {
    client: { user: { id: 'bot-1' }, guilds: { cache: { size: servers } } },
    players: new Map(Array.from({ length: players }, (_, k) => [String(k), {}])),
    db: { prepare: () => ({ get: () => undefined }) },
    config: {},
    availableModels: [],
  } as unknown as BotDeps;
}

describe('formatDuration', () => {
  it('formata dias/horas/minutos, omite zeros à cabeça', () => {
    expect(formatDuration(0)).toBe('<1m');
    expect(formatDuration(59)).toBe('<1m');
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(3660)).toBe('1h 1m');
    expect(formatDuration(90061)).toBe('1d 1h 1m');
    expect(formatDuration(86400)).toBe('1d');
  });
});

describe('/uptime — público', () => {
  it('responde com o tempo online', async () => {
    const i = makeInteraction('uptime');
    await handleInteraction(i as any, makeDeps(5, 2));
    expect(i.replies.length).toBe(1);
    expect(i.replies[0]).toMatch(/online/i);
  });

  it('é top-level, NÃO admin-only', () => {
    const def = commandDefs.find((c) => c.name === 'uptime');
    expect(def).toBeDefined();
    expect(def?.default_member_permissions ?? undefined).toBeUndefined();
  });
});

describe('/botstats — público', () => {
  it('mostra os números de servidores e sessões de voz', async () => {
    const i = makeInteraction('botstats');
    await handleInteraction(i as any, makeDeps(42, 3));
    const text = i.replies.join('\n');
    expect(text).toContain('42'); // servidores
    expect(text).toContain('3'); // sessões de voz agora
  });

  it('é top-level, NÃO admin-only (ao contrário do /stats)', () => {
    const botstats = commandDefs.find((c) => c.name === 'botstats');
    const stats = commandDefs.find((c) => c.name === 'stats');
    expect(botstats?.default_member_permissions ?? undefined).toBeUndefined();
    // /stats CONTINUA admin-only — a diferença é intencional.
    expect(stats?.default_member_permissions).toBeDefined();
  });
});
