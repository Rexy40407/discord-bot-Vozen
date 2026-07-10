import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { hardenServerTimeouts, SERVER_TIMEOUTS } from '../src/http/serverHardening';

describe('hardenServerTimeouts — timeouts defensivos nos servidores HTTP internos', () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it('aplica keepAliveTimeout / headersTimeout / requestTimeout curtos (anti-slowloris)', () => {
    server = createServer();
    hardenServerTimeouts(server);
    expect(server.keepAliveTimeout).toBe(SERVER_TIMEOUTS.keepAlive);
    expect(server.headersTimeout).toBe(SERVER_TIMEOUTS.headers);
    expect(server.requestTimeout).toBe(SERVER_TIMEOUTS.request);
  });

  it('os valores são curtos face aos defaults do Node (mitigação real)', () => {
    // Defaults do Node: requestTimeout 300000, headersTimeout 60000. Os nossos são menores.
    expect(SERVER_TIMEOUTS.request).toBeLessThan(300000);
    expect(SERVER_TIMEOUTS.headers).toBeLessThan(60000);
    // headersTimeout <= requestTimeout (senão o pedido nunca chega ao limite de headers).
    expect(SERVER_TIMEOUTS.headers).toBeLessThanOrEqual(SERVER_TIMEOUTS.request);
  });
});
