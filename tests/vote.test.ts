import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { handleVoteWebhook, startVoteWebhookServer } from '../src/vote';
import { metrics } from '../src/metrics';
import { initDb } from '../src/store/db';
import { isUserPremium, getUserPremiumExpiry } from '../src/store/premium';
import { claimVoteReward, VOTE_REWARD_HOURS } from '../src/store/voteReward';
import type { AppConfig } from '../src/config/index';

// Helper: minimal AppConfig — only the 3 webhook vars matter to the server.
function cfg(
  topggWebhookPort?: number,
  topggWebhookSecret?: string,
  topggWebhookAllowInsecure = false,
): AppConfig {
  return {
    topggWebhookPort,
    topggWebhookSecret,
    topggWebhookAllowInsecure,
  } as unknown as AppConfig;
}

const SECRET = 's3cr3t';
const UPVOTE = JSON.stringify({ bot: 'bot-1', user: 'u-123', type: 'upvote' });

describe('handleVoteWebhook — pure handler (no network)', () => {
  beforeEach(() => metrics.reset());

  it('(a) correct secret + upvote => 200 and increments votes', () => {
    const res = handleVoteWebhook({ authHeader: SECRET, body: UPVOTE, secret: SECRET });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).status).toBe('ok');
    expect(res.vote).toMatchObject({ user: 'u-123', type: 'upvote', bot: 'bot-1' });
    expect(metrics.snapshot().votes).toBe(1);
  });

  it('(b) wrong secret => 401 and does NOT increment votes', () => {
    const res = handleVoteWebhook({ authHeader: 'errado', body: UPVOTE, secret: SECRET });
    expect(res.status).toBe(401);
    expect(metrics.snapshot().votes).toBe(0);
    // does not return vote data on a rejection
    expect(res.vote).toBeUndefined();
  });

  it('(b2) missing auth header with a defined secret => 401', () => {
    const res = handleVoteWebhook({ authHeader: undefined, body: UPVOTE, secret: SECRET });
    expect(res.status).toBe(401);
    expect(metrics.snapshot().votes).toBe(0);
  });

  it('(b3) wrong secret of a different length => 401 without crashing (timingSafeEqual)', () => {
    // The constant-time comparison (crypto.timingSafeEqual) throws if the buffers
    // have different lengths — so we hash both sides to 32 bytes before comparing.
    // This test exercises the differing-lengths path (short and long) that the
    // other auth tests don't cover.
    for (const authHeader of ['x', 's3cr3t-com-muito-mais-bytes-que-o-secret-real']) {
      metrics.reset();
      const res = handleVoteWebhook({ authHeader, body: UPVOTE, secret: SECRET });
      expect(res.status, `authHeader=${authHeader}`).toBe(401);
      expect(metrics.snapshot().votes).toBe(0);
      expect(res.vote).toBeUndefined();
    }
  });

  it('(c) no secret configured => accepts the upvote (200) and counts it', () => {
    // Documented decision (literal reading of contract B1): with no secret, auth is
    // NOT verified. top.gg allows webhooks without auth, but it's insecure — so the
    // server startup warns (see the server test). authHeader is ignored.
    const res = handleVoteWebhook({ authHeader: undefined, body: UPVOTE, secret: undefined });
    expect(res.status).toBe(200);
    expect(metrics.snapshot().votes).toBe(1);
  });

  it('(c2) empty secret ("") is treated as no secret => accepts', () => {
    const res = handleVoteWebhook({ authHeader: undefined, body: UPVOTE, secret: '' });
    expect(res.status).toBe(200);
    expect(metrics.snapshot().votes).toBe(1);
  });

  it('(d) malformed JSON body => 400 without crashing and without counting', () => {
    const res = handleVoteWebhook({ authHeader: SECRET, body: '{nao e json', secret: SECRET });
    expect(res.status).toBe(400);
    expect(metrics.snapshot().votes).toBe(0);
  });

  it('(d2) empty body => 400 without crashing', () => {
    const res = handleVoteWebhook({ authHeader: SECRET, body: '', secret: SECRET });
    expect(res.status).toBe(400);
    expect(metrics.snapshot().votes).toBe(0);
  });

  it('(d3) non-object JSON body (array/number/null) => 400', () => {
    for (const body of ['[]', '42', 'null', '"texto"']) {
      metrics.reset();
      const res = handleVoteWebhook({ authHeader: SECRET, body, secret: SECRET });
      expect(res.status, `body=${body}`).toBe(400);
      expect(metrics.snapshot().votes).toBe(0);
    }
  });

  it('(e) type "test" => 200 (the dashboard test passes) but does NOT count', () => {
    const body = JSON.stringify({ bot: 'bot-1', user: 'u-123', type: 'test' });
    const res = handleVoteWebhook({ authHeader: SECRET, body, secret: SECRET });
    expect(res.status).toBe(200);
    expect(res.vote?.type).toBe('test');
    // top.gg test ping is not a real vote
    expect(metrics.snapshot().votes).toBe(0);
  });

  it('valid upvote but missing `user` field => 200 but does not count (payload not actionable)', () => {
    const body = JSON.stringify({ bot: 'bot-1', type: 'upvote' });
    const res = handleVoteWebhook({ authHeader: SECRET, body, secret: SECRET });
    expect(res.status).toBe(200);
    expect(metrics.snapshot().votes).toBe(0);
  });

  it('wrong-typed fields (numeric user) do not crash; does not count', () => {
    const body = JSON.stringify({ bot: 'bot-1', user: 123, type: 'upvote' });
    const res = handleVoteWebhook({ authHeader: SECRET, body, secret: SECRET });
    expect(res.status).toBe(200);
    // user is not a string => treated as absent => does not count
    expect(metrics.snapshot().votes).toBe(0);
  });

  it('two valid upvotes accumulate (votes=2)', () => {
    handleVoteWebhook({ authHeader: SECRET, body: UPVOTE, secret: SECRET });
    handleVoteWebhook({ authHeader: SECRET, body: UPVOTE, secret: SECRET });
    expect(metrics.snapshot().votes).toBe(2);
  });
});

describe('startVoteWebhookServer — optional startup', () => {
  let server: Server | undefined;

  beforeEach(() => metrics.reset());

  afterEach(() => {
    if (server) {
      server.close();
      server = undefined;
    }
  });

  it('does NOT start a server when topggWebhookPort is undefined', () => {
    server = startVoteWebhookServer(cfg(undefined, SECRET));
    expect(server).toBeUndefined();
  });

  it('SEC-01: port defined WITHOUT a secret and without opt-in => does NOT start', () => {
    // Safe default: without TOPGG_WEBHOOK_SECRET the listener refuses to start.
    server = startVoteWebhookServer(cfg(0, undefined, false));
    expect(server).toBeUndefined();
  });

  it('SEC-01: no secret BUT with allowInsecure=true => starts and accepts POST without auth', async () => {
    server = startVoteWebhookServer(cfg(0, undefined, true));
    expect(server).toBeDefined();
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    const addr = server!.address();
    if (addr === null || typeof addr === 'string') throw new Error('endereco inesperado');
    const res = await fetch(`http://127.0.0.1:${addr.port}/webhook/topgg`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // WITHOUT Authorization
      body: UPVOTE,
    });
    expect(res.status).toBe(200);
    expect(metrics.snapshot().votes).toBe(1);
  });

  it('starts and accepts a real POST with the correct secret (ephemeral port) and counts the vote', async () => {
    server = startVoteWebhookServer(cfg(0, SECRET)); // port 0 = ephemeral
    expect(server).toBeDefined();

    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    const addr = server!.address();
    if (addr === null || typeof addr === 'string') {
      throw new Error('endereco inesperado do servidor de webhook');
    }

    const res = await fetch(`http://127.0.0.1:${addr.port}/webhook/topgg`, {
      method: 'POST',
      headers: { Authorization: SECRET, 'Content-Type': 'application/json' },
      body: UPVOTE,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe('ok');
    expect(metrics.snapshot().votes).toBe(1);
  });

  it('POST with wrong secret => 401 and does not count', async () => {
    server = startVoteWebhookServer(cfg(0, SECRET));
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    const addr = server!.address();
    if (addr === null || typeof addr === 'string') throw new Error('endereco inesperado');

    const res = await fetch(`http://127.0.0.1:${addr.port}/webhook/topgg`, {
      method: 'POST',
      headers: { Authorization: 'errado', 'Content-Type': 'application/json' },
      body: UPVOTE,
    });
    expect(res.status).toBe(401);
    expect(metrics.snapshot().votes).toBe(0);
  });

  it('GET or wrong route => 404 (only accepts POST /webhook/topgg)', async () => {
    server = startVoteWebhookServer(cfg(0, SECRET));
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    const addr = server!.address();
    if (addr === null || typeof addr === 'string') throw new Error('endereco inesperado');

    const resGet = await fetch(`http://127.0.0.1:${addr.port}/webhook/topgg`);
    expect(resGet.status).toBe(404);
    const resWrong = await fetch(`http://127.0.0.1:${addr.port}/nope`, { method: 'POST' });
    expect(resWrong.status).toBe(404);
  });
});

describe('vote reward — a valid upvote grants temporary Plus perks', () => {
  beforeEach(() => metrics.reset());

  it('handler: valid upvote calls onUpvote with the voter id', () => {
    const rewarded: string[] = [];
    const res = handleVoteWebhook({
      authHeader: SECRET,
      body: UPVOTE,
      secret: SECRET,
      onUpvote: (userId) => rewarded.push(userId),
    });
    expect(res.status).toBe(200);
    expect(rewarded).toEqual(['u-123']);
  });

  it('handler: type "test", payload without user and wrong auth do NOT call onUpvote', () => {
    const rewarded: string[] = [];
    const onUpvote = (userId: string) => rewarded.push(userId);
    handleVoteWebhook({
      authHeader: SECRET,
      body: JSON.stringify({ user: 'u-1', type: 'test' }),
      secret: SECRET,
      onUpvote,
    });
    handleVoteWebhook({
      authHeader: SECRET,
      body: JSON.stringify({ type: 'upvote' }), // no user
      secret: SECRET,
      onUpvote,
    });
    handleVoteWebhook({ authHeader: 'errado', body: UPVOTE, secret: SECRET, onUpvote });
    expect(rewarded).toEqual([]);
  });

  it('handler: an onUpvote that throws does NOT break the response (still 200)', () => {
    const res = handleVoteWebhook({
      authHeader: SECRET,
      body: UPVOTE,
      secret: SECRET,
      onUpvote: () => {
        throw new Error('grant falhou');
      },
    });
    expect(res.status).toBe(200);
    expect(metrics.snapshot().votes).toBe(1); // the vote still counts
  });

  it('integration: an upvote POST grants 24h of Plus, and a 2nd vote in the same month does NOT accumulate (cooldown)', async () => {
    const db: Database.Database = initDb(':memory:');
    const NOW = 1_000_000;
    let server: Server | undefined;
    try {
      // The reward goes through claimVoteReward (grant + 30-day cooldown), just like
      // in index.ts. NOW is fixed so the test is deterministic (the cooldown compares against NOW).
      server = startVoteWebhookServer(cfg(0, SECRET), (userId) => {
        claimVoteReward(db, userId, NOW);
      });
      expect(server).toBeDefined();
      await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
      const addr = server!.address();
      if (addr === null || typeof addr === 'string') throw new Error('endereco inesperado');

      const post = (): Promise<Response> =>
        fetch(`http://127.0.0.1:${addr.port}/webhook/topgg`, {
          method: 'POST',
          headers: { Authorization: SECRET, 'Content-Type': 'application/json' },
          body: UPVOTE,
        });

      const res = await post();
      expect(res.status).toBe(200);
      // 24h of Plus: active now, expires exactly at NOW + VOTE_REWARD_HOURS.
      expect(isUserPremium(db, 'u-123', NOW + 1000)).toBe(true);
      expect(getUserPremiumExpiry(db, 'u-123')).toBe(NOW + VOTE_REWARD_HOURS * 3_600_000);
      expect(isUserPremium(db, 'u-123', NOW + VOTE_REWARD_HOURS * 3_600_000 + 1)).toBe(false);

      // 2nd vote (same NOW = within the cooldown): the Plus does NOT extend.
      await post();
      expect(getUserPremiumExpiry(db, 'u-123')).toBe(NOW + VOTE_REWARD_HOURS * 3_600_000);
    } finally {
      server?.close();
      db.close();
    }
  });
});
