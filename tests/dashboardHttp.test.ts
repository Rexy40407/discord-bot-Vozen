// tests/dashboardHttp.test.ts — web dashboard HTTP routes (/api/dashboard/*).
//
// Restricted CORS, Bearer required, authz (MANAGE_GUILD + bot present) in dashboardApi.
// Runs the real server (startKofiWebhook) with a real dashboardApi + fake Discord fetch.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { startKofiWebhook } from '../src/premium/kofiWebhook';
import { createDashboardApi } from '../src/premium/dashboardApi';
import { getGuildConfig } from '../src/store/guildConfig';

const TOKEN = 'good-token';
const GUILD = '123123123123123123';
const OTHER = '456456456456456456';

function fakeFetch(): typeof fetch {
  return (async (_url: string, init?: { headers?: Record<string, string> }) => {
    if (init?.headers?.Authorization !== `Bearer ${TOKEN}`) {
      return { ok: false, status: 401, json: async () => ({}) } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => [
        { id: GUILD, name: 'Meu', icon: null, permissions: '0x20' }, // MANAGE_GUILD + bot
        { id: OTHER, name: 'Outro', icon: null, permissions: '0' }, // no perm
      ],
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('/api/dashboard/* — HTTP routes', () => {
  let db: Database.Database;
  let server: Server | null = null;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(async () => {
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    }
    db.close();
  });

  async function start(): Promise<string> {
    const dashboardApi = createDashboardApi({
      db,
      now: () => 1_000,
      fetchImpl: fakeFetch(),
      botHasGuild: (id) => id === GUILD, // the bot is only in GUILD
    });
    server = startKofiWebhook({
      db,
      token: 'kofi',
      port: 0,
      now: () => 1_000,
      logInfo: () => {},
      logError: () => {},
      dashboardApi,
      apiOrigin: 'https://vozen.org',
    });
    if (!server) throw new Error('sem servidor');
    await new Promise<void>((r) => server!.once('listening', () => r()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('sem porta');
    return `http://127.0.0.1:${addr.port}`;
  }

  const auth = { authorization: `Bearer ${TOKEN}` };

  it('GET /guilds without token -> 401', async () => {
    const base = await start();
    expect((await fetch(`${base}/api/dashboard/guilds`)).status).toBe(401);
  });

  it('GET /guilds invalid token -> 401', async () => {
    const base = await start();
    const res = await fetch(`${base}/api/dashboard/guilds`, {
      headers: { authorization: 'Bearer mau' },
    });
    expect(res.status).toBe(401);
  });

  it('GET /guilds -> 200 only with the manageable servers (MANAGE_GUILD + bot)', async () => {
    const base = await start();
    const res = await fetch(`${base}/api/dashboard/guilds`, { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { guilds: { id: string }[] };
    expect(body.guilds.map((g) => g.id)).toEqual([GUILD]);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://vozen.org');
  });

  it('GET /guild/<manageable> -> 200 with the config; non-manageable guild -> 403', async () => {
    const base = await start();
    const ok = await fetch(`${base}/api/dashboard/guild/${GUILD}`, { headers: auth });
    expect(ok.status).toBe(200);
    const forbidden = await fetch(`${base}/api/dashboard/guild/${OTHER}`, { headers: auth });
    expect(forbidden.status).toBe(403);
  });

  it('GET /guild/<non-numeric> -> 400', async () => {
    const base = await start();
    expect((await fetch(`${base}/api/dashboard/guild/abc`, { headers: auth })).status).toBe(400);
  });

  it('POST /guild/<manageable> applies the patch and persists', async () => {
    const base = await start();
    const res = await fetch(`${base}/api/dashboard/guild/${GUILD}`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ xsaid: false, ttsChannelId: 'INJECT' }),
    });
    expect(res.status).toBe(200);
    const cfg = getGuildConfig(db, GUILD);
    expect(cfg.xsaid).toBe(false); // applied
    expect(cfg.ttsChannelId).toBeNull(); // injection outside the whitelist ignored
  });

  it('POST /guild/<non-manageable> -> 403 (does not write)', async () => {
    const base = await start();
    const res = await fetch(`${base}/api/dashboard/guild/${OTHER}`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ xsaid: false }),
    });
    expect(res.status).toBe(403);
  });

  it('POST with invalid JSON -> 400', async () => {
    const base = await start();
    const res = await fetch(`${base}/api/dashboard/guild/${GUILD}`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: '{ nao json',
    });
    expect(res.status).toBe(400);
  });
});
