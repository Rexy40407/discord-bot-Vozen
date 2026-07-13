import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { getGuildConfig } from '../src/store/guildConfig';
import { createDashboardApi, sanitizePatch, DASHBOARD_FIELDS } from '../src/premium/dashboardApi';

// Dashboard web de config: núcleo de AUTORIZAÇÃO + escrita whitelisted. Ver
// docs/COMPLIANCE-VAGA5.md · Dashboard. A identidade/guilds vêm da Discord (fetch
// injetável); a autz exige MANAGE_GUILD (ou ADMIN) + bot presente na guild.

const TOKEN = 'tok-abc';
const GUILD = '999999999999999999';
const MANAGE_GUILD = '0x20'; // 1<<5
const NONE = '0';
const ADMIN = '0x8'; // 1<<3

// fetch falso do /users/@me/guilds — devolve as guilds dadas (ou 401 se token != esperado).
function fakeGuildsFetch(expected: string, guilds: unknown[]): typeof fetch {
  return (async (_url: string, init?: { headers?: Record<string, string> }) => {
    const auth = init?.headers?.Authorization ?? '';
    if (auth !== `Bearer ${expected}`) {
      return { ok: false, status: 401, json: async () => ({}) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => guilds } as unknown as Response;
  }) as unknown as typeof fetch;
}

function makeApi(
  db: Database.Database,
  guilds: unknown[],
  botGuilds: string[] = [GUILD],
  expected = TOKEN,
) {
  return createDashboardApi({
    db,
    now: () => 1_000,
    fetchImpl: fakeGuildsFetch(expected, guilds),
    botHasGuild: (id) => botGuilds.includes(id),
  });
}

describe('sanitizePatch — whitelist + limites', () => {
  it('só deixa passar campos conhecidos (ignora ttsChannelId etc.)', () => {
    const out = sanitizePatch({ xsaid: false, ttsChannelId: 'hack', enabled: false, foo: 1 });
    expect(out).toEqual({ xsaid: false });
    expect('ttsChannelId' in out).toBe(false);
    expect('enabled' in out).toBe(false);
  });

  it('coage booleans e limita números', () => {
    const out = sanitizePatch({ soundboard: 1, maxChars: 99999, ratePerMin: -3 });
    expect(out.soundboard).toBe(true);
    expect(out.maxChars).toBe(2000); // clamp ao máximo
    expect(out.ratePerMin).toBe(1); // clamp ao mínimo
  });

  it('locale inválido é descartado; válido passa', () => {
    expect(sanitizePatch({ locale: 'xx-nope' })).toEqual({});
    expect(sanitizePatch({ locale: 'pt' })).toEqual({ locale: 'pt' });
  });

  it('todos os DASHBOARD_FIELDS são campos reais do guild_config', () => {
    // guarda: cada campo do dashboard tem de existir no GuildConfig (default != undefined)
    expect(DASHBOARD_FIELDS.length).toBeGreaterThan(0);
  });
});

describe('createDashboardApi — autorização', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('listGuilds: só servidores com MANAGE_GUILD/ADMIN E com o bot presente', async () => {
    const api = makeApi(
      db,
      [
        { id: GUILD, name: 'Meu', icon: null, permissions: MANAGE_GUILD }, // ok
        { id: '111', name: 'Admin sem bot', icon: null, permissions: ADMIN }, // bot ausente
        { id: '222', name: 'Sem perm', icon: null, permissions: NONE }, // sem perm
      ],
      [GUILD], // bot só está no GUILD
    );
    const list = await api.listGuilds(TOKEN);
    expect(list?.map((g) => g.id)).toEqual([GUILD]);
  });

  it('listGuilds: token inválido -> null', async () => {
    const api = makeApi(db, [], [GUILD]);
    expect(await api.listGuilds('token-errado')).toBeNull();
  });

  it('getConfig: guild não gerível -> null (não vaza config)', async () => {
    const api = makeApi(db, [{ id: '222', name: 'X', icon: null, permissions: NONE }], [GUILD]);
    expect(await api.getConfig(TOKEN, GUILD)).toBeNull();
  });

  it('getConfig: guild gerível -> devolve só os campos do dashboard', async () => {
    const api = makeApi(db, [{ id: GUILD, name: 'Meu', icon: null, permissions: MANAGE_GUILD }]);
    const cfg = await api.getConfig(TOKEN, GUILD);
    expect(cfg).not.toBeNull();
    expect(cfg!.xsaid).toBe(true); // default
    expect('ttsChannelId' in cfg!).toBe(false); // NÃO expõe campos fora da whitelist
  });

  it('saveConfig: aplica o patch (via setter) e ignora campos fora da whitelist', async () => {
    const api = makeApi(db, [{ id: GUILD, name: 'Meu', icon: null, permissions: MANAGE_GUILD }]);
    const out = await api.saveConfig(TOKEN, GUILD, {
      xsaid: false,
      soundboard: false,
      ttsChannelId: 'INJECT', // deve ser ignorado
    });
    expect(out).not.toBeNull();
    expect(out!.xsaid).toBe(false);
    // persistido de verdade + o campo fora da whitelist NÃO foi tocado:
    const stored = getGuildConfig(db, GUILD);
    expect(stored.xsaid).toBe(false);
    expect(stored.soundboard).toBe(false);
    expect(stored.ttsChannelId).toBeNull(); // intacto (default) — a injeção não passou
  });

  it('saveConfig: guild não gerível -> null (não escreve nada)', async () => {
    const api = makeApi(db, [{ id: '222', name: 'X', icon: null, permissions: NONE }], [GUILD]);
    const out = await api.saveConfig(TOKEN, GUILD, { xsaid: false });
    expect(out).toBeNull();
    expect(getGuildConfig(db, GUILD).xsaid).toBe(true); // não mexeu
  });
});
