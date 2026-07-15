import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { isUserPremium } from '../src/store/premium';
import { startKofiWebhook } from '../src/premium/kofiWebhook';
import { claimVoteReward } from '../src/store/voteReward';

// The vote reward now travels on the SAME HTTP server as Ko-fi/the panel (which is already
// public via Caddy at api.vozen.org), on the POST /webhook/topgg route — to avoid requiring
// a dedicated port + a new Caddy route. These tests exercise that route end-to-end.
const SECRET = 'topgg-s3cr3t';
const UPVOTE = JSON.stringify({ bot: 'b1', user: 'u-9', type: 'upvote' });

function urlOf(s: Server, path: string): string {
  const addr = s.address();
  if (!addr || typeof addr === 'string') throw new Error('porta efémera indisponível');
  return `http://127.0.0.1:${addr.port}${path}`;
}

describe('top.gg webhook on the public API (POST /webhook/topgg route)', () => {
  let db: Database.Database;
  let server: Server | null = null;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
    db.close();
  });

  async function start(opts: {
    secret?: string;
    onUpvote?: (id: string) => void;
  }): Promise<Server> {
    server = startKofiWebhook({
      db,
      token: 'tok', // Ko-fi wired in parallel — the top.gg route must not be swallowed by it
      port: 0,
      now: () => 1_000_000,
      logInfo: () => {},
      logError: () => {},
      topggWebhookSecret: opts.secret,
      onUpvote: opts.onUpvote,
    });
    if (!server) throw new Error('servidor não arrancou');
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    return server;
  }

  async function post(s: Server, body: string, auth?: string): Promise<number> {
    const res = await fetch(urlOf(s, '/webhook/topgg'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      body,
    });
    return res.status;
  }

  it('upvote with the right secret -> 200 and calls onUpvote with the voter id', async () => {
    const rewarded: string[] = [];
    const s = await start({ secret: SECRET, onUpvote: (id) => rewarded.push(id) });
    expect(await post(s, UPVOTE, SECRET)).toBe(200);
    expect(rewarded).toEqual(['u-9']);
  });

  it('wrong secret -> 401 and does NOT call onUpvote', async () => {
    const rewarded: string[] = [];
    const s = await start({ secret: SECRET, onUpvote: (id) => rewarded.push(id) });
    expect(await post(s, UPVOTE, 'errado')).toBe(401);
    expect(rewarded).toEqual([]);
  });

  it('real wiring: onUpvote=claimVoteReward grants 24h of Plus to the voter', async () => {
    const s = await start({
      secret: SECRET,
      onUpvote: (id) => {
        claimVoteReward(db, id, 1_000_000);
      },
    });
    expect(await post(s, UPVOTE, SECRET)).toBe(200);
    expect(isUserPremium(db, 'u-9', 1_000_000 + 1000)).toBe(true);
  });

  it('without topggWebhookSecret configured -> the route is NOT a vote endpoint (no reward)', async () => {
    const rewarded: string[] = [];
    const s = await start({ onUpvote: (id) => rewarded.push(id) }); // no secret
    await post(s, UPVOTE, SECRET); // status is irrelevant; what matters is not rewarding
    expect(rewarded).toEqual([]);
  });
});
