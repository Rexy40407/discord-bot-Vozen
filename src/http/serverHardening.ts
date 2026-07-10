// src/http/serverHardening.ts
//
// Timeouts defensivos partilhados pelos servidores HTTP internos do bot (webhook do Ko-fi
// + API premium, webhook do top.gg, health). Sem estes, os defaults do Node são largos
// (requestTimeout 5min, headersTimeout 60s) e um cliente lento pode segurar sockets
// (slowloris). Os endpoints legítimos são pequenos e o Caddy termina o TLS à frente, por
// isso valores curtos são seguros. Um único sítio para todos os servidores usarem.

import type { Server } from 'node:http';

/** Timeouts (ms). headersTimeout ≤ requestTimeout; keepAlive curto para libertar sockets. */
export const SERVER_TIMEOUTS = {
  keepAlive: 5000,
  headers: 10000,
  request: 20000,
} as const;

/** Aplica os timeouts defensivos a um http.Server (chamar logo após createServer). */
export function hardenServerTimeouts(server: Server): void {
  server.keepAliveTimeout = SERVER_TIMEOUTS.keepAlive;
  server.headersTimeout = SERVER_TIMEOUTS.headers;
  server.requestTimeout = SERVER_TIMEOUTS.request;
}
