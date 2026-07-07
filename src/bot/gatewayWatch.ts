// src/bot/gatewayWatch.ts
//
// Observabilidade + recuperação do GATEWAY do Discord.
//
// Causa raiz do "Falha ao carregar opções" recorrente: o bot ficava "online" mas
// PARAVA de receber interações (gateway zombie) — event-loop idle (0% CPU), nenhuma
// interação a chegar ao handler, e ZERO no log porque o discord.js não regista
// problemas de shard sem que se ouçam estes eventos. Aqui:
//   1. ligamos os listeners de shard (disconnect/reconnecting/resume/ready/error) —
//      o CÓDIGO de fecho da desconexão diz PORQUÊ (ex.: 4014 = intents proibidos);
//   2. um heartbeat periódico (estado do WS) — "silêncio" deixa de ser ambíguo;
//   3. um watchdog: se o gateway estiver NÃO-Ready de forma sustentada, saímos com
//      código != 0 para o supervisor (start-prod.mjs) reiniciar de FRESCO — a forma
//      mais fiável de recuperar de uma sessão zombie.
//
// A decisão do watchdog vive numa função PURA (evaluateGateway) para ser testável
// sem timers nem um Client real.

import { type Client, Events, Status } from 'discord.js';

export interface GatewayDecision {
  healthy: boolean;
  /** Instante (ms) em que ficou não-saudável, ou null se saudável. */
  unhealthySince: number | null;
  /** Há quanto tempo (ms) está não-saudável (0 se saudável). */
  downMs: number;
  /** true => está em baixo há mais do que o limite: reiniciar. */
  shouldRestart: boolean;
}

/**
 * Decisão pura do watchdog. `statusReady` = o WS está Ready. Devolve o novo
 * `unhealthySince` (a re-injetar na próxima chamada) e se se deve reiniciar.
 */
export function evaluateGateway(
  statusReady: boolean,
  unhealthySince: number | null,
  now: number,
  maxDownMs: number,
): GatewayDecision {
  if (statusReady) {
    return { healthy: true, unhealthySince: null, downMs: 0, shouldRestart: false };
  }
  const since = unhealthySince ?? now;
  const downMs = now - since;
  return { healthy: false, unhealthySince: since, downMs, shouldRestart: downMs > maxDownMs };
}

export interface GatewayWatchDeps {
  client: Client;
  logInfo: (m: string) => void;
  logWarn: (m: string) => void;
  logError: (m: string, e?: unknown) => void;
  reportError: (e: unknown, ctx: string) => void;
  exit: () => void;
  now?: () => number;
  /** Cadência do watchdog (default 60s). */
  checkMs?: number;
  /** Tempo NÃO-Ready até reiniciar (default 120s). */
  maxDownMs?: number;
  /** A cada quantas verificações saudáveis se regista um heartbeat (default 5 => ~5min). */
  healthyLogEvery?: number;
}

/** Liga os listeners de shard + o heartbeat/watchdog. Devolve um stop() (para testes). */
export function bindGatewayWatch(deps: GatewayWatchDeps): { stop: () => void } {
  const {
    client,
    logInfo,
    logWarn,
    logError,
    reportError,
    exit,
    now = () => Date.now(),
    checkMs = 60_000,
    maxDownMs = 120_000,
    healthyLogEvery = 5,
  } = deps;

  // ── Listeners de shard: tornam o gateway VISÍVEL no log ──────────────────────
  client.on(Events.ShardDisconnect, (event, id) => {
    // event.code é o código de fecho do WebSocket — a pista mais importante.
    logWarn(
      `[gateway] shard ${id} desligou (código ${event?.code ?? '?'}) — o discord.js vai reconectar.`,
    );
  });
  client.on(Events.ShardReconnecting, (id) => logWarn(`[gateway] shard ${id} a reconectar…`));
  client.on(Events.ShardResume, (id, replayed) =>
    logInfo(`[gateway] shard ${id} retomado (${replayed} eventos recuperados).`),
  );
  client.on(Events.ShardReady, (id) => logInfo(`[gateway] shard ${id} pronto.`));
  client.on(Events.ShardError, (err, id) => {
    logError(`[gateway] erro no shard ${id}`, err);
    reportError(err, 'shardError');
  });
  client.on(Events.Warn, (m) => logWarn(`[gateway] aviso: ${m}`));

  // ── Heartbeat + watchdog ─────────────────────────────────────────────────────
  let unhealthySince: number | null = null;
  let healthyTicks = 0;
  const timer = setInterval(() => {
    const ready = client.ws.status === Status.Ready;
    const decision = evaluateGateway(ready, unhealthySince, now(), maxDownMs);
    unhealthySince = decision.unhealthySince;
    if (decision.healthy) {
      // Regista o heartbeat saudável só de vez em quando (não encher o log).
      if (healthyTicks % healthyLogEvery === 0) {
        logInfo(
          `[gateway] saudável: Ready, ping ${Math.round(client.ws.ping)}ms, ${client.guilds.cache.size} servidor(es).`,
        );
      }
      healthyTicks++;
      return;
    }
    healthyTicks = 0;
    logWarn(
      `[gateway] NÃO-Ready (status ${client.ws.status}) há ${Math.round(decision.downMs / 1000)}s.`,
    );
    if (decision.shouldRestart) {
      logError(
        '[gateway] gateway em baixo além do limite — a SAIR para o supervisor reiniciar limpo.',
      );
      exit();
    }
  }, checkMs);
  timer.unref?.();

  return { stop: () => clearInterval(timer) };
}
