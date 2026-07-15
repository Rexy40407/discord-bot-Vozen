// src/health.ts
//
// OPTIONAL HTTP health endpoint for uptime monitors (e.g. UptimeRobot).
//
// Design:
//  - `healthResponse(path)` is a PURE function (no effects, no port opened):
//    returns { status, body } for a given request path. Testable without network.
//  - `startHealthServer(config)` creates an http.Server that uses the handler and
//    listen(port) — but ONLY if `config.healthPort` is defined. Without a port,
//    returns undefined and opens nothing (default = no server).
//
// The body is MINIMAL on purpose: just {"status":"ok"}. We don't expose tokens,
// IDs, guild count or any sensitive data on an unauthenticated endpoint.

import http from 'node:http';
import type { Server } from 'node:http';
import { log } from './logging/logger';
import type { AppConfig } from './config/index';
import { hardenServerTimeouts } from './http/serverHardening';

export interface HealthResult {
  status: number;
  body: string;
}

/**
 * Pure handler. GET to /health => 200 {"status":"ok"}; any other path => 404.
 *
 * Accepts the raw request path (req.url). Matches on the path only, ignoring the
 * query string (e.g. some monitors append `?probe=...`), comparing only the part
 * before the first '?'.
 */
export function healthResponse(reqPath: string | undefined): HealthResult {
  const path = (reqPath ?? '').split('?')[0];
  if (path === '/health') {
    return { status: 200, body: JSON.stringify({ status: 'ok' }) };
  }
  return { status: 404, body: JSON.stringify({ status: 'not_found' }) };
}

/**
 * OPTIONAL startup of the health server.
 *  - If `config.healthPort` is undefined (default), starts NOTHING and returns
 *    undefined.
 *  - Otherwise, creates an http.Server that responds via `healthResponse` and
 *    listens on the port. Returns the Server handle (so the caller/tests can close
 *    it or read the ephemeral address when listen(0)).
 */
export function startHealthServer(config: Pick<AppConfig, 'healthPort'>): Server | undefined {
  const port = config.healthPort;
  if (port === undefined) return undefined;

  const server = http.createServer((req, res) => {
    // A client that cuts the connection mid-request emits 'error' on the req
    // stream; without a listener, Node rethrows it as an uncaught exception. Mirrors
    // the webhook server (vote.ts) which already has this guard.
    req.on('error', (err) => {
      log.warn('[health] request stream error (ignored)', err);
    });
    const { status, body } = healthResponse(req.url);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
  });

  server.on('error', (err) => {
    log.error(`[health] server error (port ${port})`, err);
  });

  hardenServerTimeouts(server); // short timeouts (anti-slowloris)

  // Loopback-only (defense in depth): health is for local/proxy monitoring.
  server.listen(port, '127.0.0.1', () => {
    log.info(`[health] server listening on 127.0.0.1:${port} (GET /health).`);
  });

  return server;
}
