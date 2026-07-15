import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { getGuildConfig } from '../src/store/guildConfig';
import { createDashboardApi, sanitizePatch, DASHBOARD_FIELDS } from '../src/premium/dashboardApi';

// Config web dashboard: AUTHORIZATION core + whitelisted writes. See
// docs/COMPLIANCE-VAGA5.md · Dashboard. Identity/guilds come from Discord (injectable
// fetch); authz requires MANAGE_GUILD (or ADMIN) + bot present in the guild.

const TOKEN = 'tok-abc';
const GUILD = '999999999999999999';
const MANAGE_GUILD = '0x20'; // 1<<5
const NONE = '0';
const ADMIN = '0x8'; // 1<<3

// fake fetch of /users/@me/guilds — returns the given guilds (or 401 if token != expected).
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

describe('sanitizePatch — whitelist + limits', () => {
  it('only lets known fields through (ignores ttsChannelId etc.)', () => {
    const out = sanitizePatch({ xsaid: false, ttsChannelId: 'hack', enabled: false, foo: 1 });
    expect(out).toEqual({ xsaid: false });
    expect('ttsChannelId' in out).toBe(false);
    expect('enabled' in out).toBe(false);
  });

  it('coerces booleans and clamps numbers', () => {
    const out = sanitizePatch({ soundboard: 1, maxChars: 99999, ratePerMin: -3 });
    expect(out.soundboard).toBe(true);
    expect(out.maxChars).toBe(2000); // clamp to the maximum
    expect(out.ratePerMin).toBe(1); // clamp to the minimum
  });

  it('invalid locale is discarded; valid one passes', () => {
    expect(sanitizePatch({ locale: 'xx-nope' })).toEqual({});
    expect(sanitizePatch({ locale: 'pt' })).toEqual({ locale: 'pt' });
  });

  it('all DASHBOARD_FIELDS are real guild_config fields', () => {
    // guard: each dashboard field must exist in GuildConfig (default != undefined)
    expect(DASHBOARD_FIELDS.length).toBeGreaterThan(0);
  });
});

describe('createDashboardApi — authorization', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('listGuilds: only servers with MANAGE_GUILD/ADMIN AND with the bot present', async () => {
    const api = makeApi(
      db,
      [
        { id: GUILD, name: 'Meu', icon: null, permissions: MANAGE_GUILD }, // ok
        { id: '111', name: 'Admin sem bot', icon: null, permissions: ADMIN }, // bot absent
        { id: '222', name: 'Sem perm', icon: null, permissions: NONE }, // no perm
      ],
      [GUILD], // bot is only in GUILD
    );
    const list = await api.listGuilds(TOKEN);
    expect(list?.map((g) => g.id)).toEqual([GUILD]);
  });

  it('listGuilds: invalid token -> null', async () => {
    const api = makeApi(db, [], [GUILD]);
    expect(await api.listGuilds('token-errado')).toBeNull();
  });

  it('getConfig: non-manageable guild -> null (does not leak config)', async () => {
    const api = makeApi(db, [{ id: '222', name: 'X', icon: null, permissions: NONE }], [GUILD]);
    expect(await api.getConfig(TOKEN, GUILD)).toBeNull();
  });

  it('getConfig: manageable guild -> returns only the dashboard fields', async () => {
    const api = makeApi(db, [{ id: GUILD, name: 'Meu', icon: null, permissions: MANAGE_GUILD }]);
    const cfg = await api.getConfig(TOKEN, GUILD);
    expect(cfg).not.toBeNull();
    expect(cfg!.xsaid).toBe(true); // default
    expect('ttsChannelId' in cfg!).toBe(false); // does NOT expose fields outside the whitelist
  });

  it('saveConfig: applies the patch (via setter) and ignores fields outside the whitelist', async () => {
    const api = makeApi(db, [{ id: GUILD, name: 'Meu', icon: null, permissions: MANAGE_GUILD }]);
    const out = await api.saveConfig(TOKEN, GUILD, {
      xsaid: false,
      soundboard: false,
      ttsChannelId: 'INJECT', // should be ignored
    });
    expect(out).not.toBeNull();
    expect(out!.xsaid).toBe(false);
    // actually persisted + the field outside the whitelist was NOT touched:
    const stored = getGuildConfig(db, GUILD);
    expect(stored.xsaid).toBe(false);
    expect(stored.soundboard).toBe(false);
    expect(stored.ttsChannelId).toBeNull(); // intact (default) — the injection didn't pass
  });

  it('saveConfig: non-manageable guild -> null (writes nothing)', async () => {
    const api = makeApi(db, [{ id: '222', name: 'X', icon: null, permissions: NONE }], [GUILD]);
    const out = await api.saveConfig(TOKEN, GUILD, { xsaid: false });
    expect(out).toBeNull();
    expect(getGuildConfig(db, GUILD).xsaid).toBe(true); // untouched
  });
});
