// src/vote.ts
//
// OPTIONAL top.gg webhook to record bot votes (P11.5).
//
// Design (mirrors src/health.ts):
//  - `handleVoteWebhook({ authHeader, body, secret })` is a PURE function (no
//    network, no port opened): validates the secret, parses the top.gg payload and
//    returns { status, body }. Increments the `votes` metric on a valid upvote,
//    a la AudioCache.get (which also touches the metrics singleton inside the
//    unit). Testable without network.
//  - `startVoteWebhookServer(config)` creates an http.Server that collects the POST
//    body and calls the handler — but ONLY if `config.topggWebhookPort` is
//    defined. Without a port, returns undefined and opens nothing (default = no
//    server), exactly like the health endpoint.
//
// Security:
//  - If `secret` is defined, the Authorization header MUST match (401 otherwise).
//    The comparison is constant-time (crypto.timingSafeEqual over the SHA-256 of
//    both sides) so as not to leak the secret via timing — see authMatches().
//    top.gg allows webhooks without auth, but it's insecure — so we always
//    recommend setting TOPGG_WEBHOOK_SECRET (see .env.example and the startup
//    warning in startVoteWebhookServer).
//  - Without a `secret` configured, the webhook by default does NOT start (SEC-01) —
//    without auth, anyone who discovers the port forges votes. To start anyway
//    (without auth), the explicit opt-in TOPGG_WEBHOOK_ALLOW_INSECURE=true is required.
//
// The top.gg payload (POST JSON) has, among others, these fields:
//   { bot: "<id>", user: "<id of the voter>", type: "upvote" | "test", ... }
// "test" is a ping from the top.gg dashboard ("Test webhook" button): we respond
// 200 so the test passes, but we do NOT count it as a vote (only type === "upvote").
//
// NOTE — "live pending": the bot's top.gg listing and the TOPGG_WEBHOOK_SECRET
// belong to the bot owner. This part builds the code + tests; wiring the webhook
// live (creating the listing, pasting the secret, exposing the port) is left to the
// user's deploy.

import http from 'node:http';
import type { Server } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { log } from './logging/logger';
import { metrics } from './metrics';
import type { AppConfig } from './config/index';
import { hardenServerTimeouts } from './http/serverHardening';

export interface VoteWebhookInput {
  /** Value of the request's Authorization header (or undefined if absent). */
  authHeader: string | undefined;
  /** Raw request body (top.gg JSON string). */
  body: string;
  /** Expected secret. If undefined/empty, auth is NOT verified. */
  secret: string | undefined;
  /**
   * Reward: called with the voter's id on EVERY valid upvote (same condition as the
   * `votes` metric). The caller wires the perk grant here (see index.ts). A throw
   * here does NOT break the response — top.gg doesn't re-deliver failed webhooks, so
   * we respond 200 anyway and leave the error to the callback itself to log.
   */
  onUpvote?: (userId: string) => void;
}

export interface VoteData {
  /** Id of the voter (top.gg's `user` field). */
  user: string;
  /** Event type: "upvote" (real vote) or "test" (dashboard ping). */
  type: string;
  /** Id of the voted bot (top.gg's `bot` field), if present. */
  bot?: string;
}

/**
 * Compares the auth header with the secret in constant time.
 *
 * `authHeader !== secret` short-circuits at the first differing byte, so the
 * response time reveals how many bytes match — a timing side-channel on an
 * authentication path. We use `crypto.timingSafeEqual`.
 *
 * `timingSafeEqual` THROWS if the buffers have different lengths; so we hash
 * both sides to a 32-byte SHA-256 (fixed length) before comparing. Bonus: the
 * digest also doesn't leak the secret's length.
 */
function authMatches(authHeader: string | undefined, secret: string): boolean {
  const a = createHash('sha256')
    .update(authHeader ?? '')
    .digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}

export interface VoteWebhookResult {
  status: number;
  /** JSON body of the response. */
  body: string;
  /** Vote data, present only on a successful parse (200). */
  vote?: VoteData;
}

/**
 * PURE handler for the top.gg webhook.
 *
 * Order (auth BEFORE any parse, as in a gateway):
 *  1. If `secret` is defined and the authHeader doesn't match (constant-time
 *     comparison) => 401 (does NOT count a vote).
 *  2. Parse the JSON body. Invalid/malformed body => 400 (no crash).
 *  3. Success => 200 + vote data. If type === "upvote", increments `votes`.
 *     type === "test" => 200 but does NOT count (it's a test ping from the dashboard).
 */
export function handleVoteWebhook(input: VoteWebhookInput): VoteWebhookResult {
  const { authHeader, body, secret, onUpvote } = input;

  // 1. Auth — only when a secret is configured (literal reading of the contract).
  //    Constant-time comparison (timingSafeEqual) so as not to leak the secret via
  //    timing — see authMatches().
  if (secret !== undefined && secret !== '' && !authMatches(authHeader, secret)) {
    return { status: 401, body: JSON.stringify({ status: 'unauthorized' }) };
  }

  // 2. Defensive parse — malformed input can NEVER crash.
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { status: 400, body: JSON.stringify({ status: 'invalid_json' }) };
  }
  // Require a JSON object (not null, not array, not primitive). The top.gg payload
  // is always an object { user, type, ... }; an array/number/string isn't
  // actionable => 400.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 400, body: JSON.stringify({ status: 'invalid_payload' }) };
  }

  const obj = parsed as Record<string, unknown>;
  const type = typeof obj.type === 'string' ? obj.type : '';
  const user = typeof obj.user === 'string' ? obj.user : '';
  const bot = typeof obj.bot === 'string' ? obj.bot : undefined;

  // A valid upvote needs a `user` (the voter). Without it, the payload isn't
  // actionable: we accept (200) but don't count — avoids inflating the metric with
  // empty pings. type "test" also falls here (doesn't count), and that's the desired.
  const vote: VoteData = { user, type, ...(bot !== undefined ? { bot } : {}) };

  if (type === 'upvote' && user !== '') {
    metrics.inc('votes');
    // Reward (temporary Plus perks): same condition as the metric. A throw from the
    // callback can't break the 200 — the vote counted and top.gg doesn't re-deliver.
    try {
      onUpvote?.(user);
    } catch {
      /* the callback is responsible for its own logging (see index.ts) */
    }
  }

  return { status: 200, body: JSON.stringify({ status: 'ok' }), vote };
}

/**
 * OPTIONAL startup of the top.gg webhook server (mirrors startHealthServer).
 *  - If `config.topggWebhookPort` is undefined (default), starts NOTHING and
 *    returns undefined.
 *  - Otherwise, creates an http.Server that accepts POST /webhook/topgg,
 *    collects the body, calls `handleVoteWebhook` (with the secret from config) and
 *    responds. Any other route/method => 404. Returns the Server handle.
 *
 * DEDICATED port (TOPGG_WEBHOOK_PORT), separate from HEALTH_PORT on purpose —
 * so as not to mix a public uptime endpoint with an authenticated webhook
 * endpoint.
 */
export function startVoteWebhookServer(
  config: Pick<AppConfig, 'topggWebhookPort' | 'topggWebhookSecret' | 'topggWebhookAllowInsecure'>,
  onUpvote?: (userId: string) => void,
): Server | undefined {
  const port = config.topggWebhookPort;
  if (port === undefined) return undefined;

  const secret = config.topggWebhookSecret;
  if (secret === undefined || secret === '') {
    if (!config.topggWebhookAllowInsecure) {
      // SEC-01: without a secret, anyone who discovers the port forges votes. Refusing
      // to start is the safe default; the explicit opt-in is left to those who know the risk.
      log.error(
        `[vote] TOPGG_WEBHOOK_PORT definido (${port}) mas TOPGG_WEBHOOK_SECRET vazio — ` +
          'the webhook will not start. Set TOPGG_WEBHOOK_SECRET, or explicitly accept the ' +
          'risk with TOPGG_WEBHOOK_ALLOW_INSECURE=true to start without authentication.',
      );
      return undefined;
    }
    log.warn(
      `[vote] TOPGG_WEBHOOK_PORT definido (${port}) sem TOPGG_WEBHOOK_SECRET e com ` +
        'TOPGG_WEBHOOK_ALLOW_INSECURE=true; webhook authentication is disabled (unsafe).',
    );
  }

  const server = http.createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (req.method !== 'POST' || path !== '/webhook/topgg') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'not_found' }));
      return;
    }

    // Collect the POST body with a defensive cap: a giant body shouldn't exhaust
    // memory. The top.gg payload is small; 64KB is generous.
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX = 64 * 1024;
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX) {
        aborted = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'payload_too_large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      const body = Buffer.concat(chunks).toString('utf8');
      const authHeader = req.headers['authorization'];
      const result = handleVoteWebhook({
        authHeader: typeof authHeader === 'string' ? authHeader : undefined,
        body,
        secret,
        onUpvote,
      });
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(result.body);
    });
    req.on('error', (err) => {
      log.error('[vote] failed to read the webhook body', err);
      if (!res.headersSent) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'bad_request' }));
      }
    });
  });

  server.on('error', (err) => {
    log.error(`[vote] top.gg webhook server error (port ${port})`, err);
  });

  hardenServerTimeouts(server); // short timeouts (anti-slowloris)

  // Loopback-only (defense in depth): public exposure is done via a reverse proxy on
  // the same host (Caddy), never with the raw port on the internet.
  server.listen(port, '127.0.0.1', () => {
    log.info(`[vote] top.gg webhook server listening on 127.0.0.1:${port} (POST /webhook/topgg).`);
  });

  return server;
}
