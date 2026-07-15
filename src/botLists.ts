// src/botLists.ts — Wave 3
//
// Auto-post of the server count to top.gg. Bot lists rank by popularity and use
// server_count for discovery; publishing it periodically helps Vozen climb and get
// noticed. OPT-IN: only starts if TOPGG_TOKEN is defined.
//
// Endpoint (official): POST https://top.gg/api/bots/{botId}/stats
//   headers: { Authorization: <token>, Content-Type: application/json }
//   body:    { "server_count": <N> }

import { log } from './logging/logger';

const TOPGG_STATS_URL = (botId: string): string => `https://top.gg/api/bots/${botId}/stats`;
/** Interval between publications (30 min) — the lists don't need more frequency. */
export const BOTLIST_POST_INTERVAL_MS = 30 * 60 * 1000;
const POST_TIMEOUT_MS = 10000;

/**
 * Publishes the server count to top.gg. PURE relative to the environment (receives the
 * token/id/count and an injectable `fetchImpl` for testing). Returns true on success
 * (HTTP 2xx), false otherwise — NEVER throws (a network failure shouldn't take down the
 * bot or the interval). Defensive timeout.
 */
export async function postTopggStats(
  botId: string,
  token: string,
  serverCount: number,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(TOPGG_STATS_URL(botId), {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ server_count: serverCount }),
      signal: controller.signal,
    });
    if (!res.ok) {
      log.warn(`[botlist] top.gg returned HTTP ${res.status} while publishing server_count.`);
      return false;
    }
    log.info(`[botlist] top.gg updated: ${serverCount} servers.`);
    return true;
  } catch (err) {
    log.warn('[botlist] failed to publish to top.gg (ignored):', (err as Error).message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface BotListDeps {
  /** Application id of the bot (= id on top.gg). */
  botId: string;
  /** top.gg API token (opt-in). Absent/empty => the updater doesn't start. */
  token?: string;
  /** Returns the CURRENT server count (e.g. () => client.guilds.cache.size). */
  serverCount: () => number;
  // Injectable for testing (timers + fetch); defaults = real globals.
  setIntervalImpl?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalImpl?: (h: ReturnType<typeof setInterval>) => void;
  fetchImpl?: typeof fetch;
}

/**
 * Starts the periodic updater. OPT-IN: without `token`, returns a no-op stop() and does
 * nothing (default). With a token, publishes ONCE right away and then every
 * BOTLIST_POST_INTERVAL_MS. Returns a stop() that cancels the interval (used in
 * shutdown/tests). The timer is `unref`'d to never hold the process open.
 */
export function startBotListUpdater(deps: BotListDeps): () => void {
  if (!deps.token) return () => {};
  const token = deps.token;
  const setIv = deps.setIntervalImpl ?? setInterval;
  const clearIv = deps.clearIntervalImpl ?? clearInterval;
  const post = (): void => {
    void postTopggStats(deps.botId, token, deps.serverCount(), deps.fetchImpl ?? fetch);
  };
  post(); // first publication immediately
  const handle = setIv(post, BOTLIST_POST_INTERVAL_MS);
  (handle as unknown as { unref?: () => void }).unref?.();
  log.info('[botlist] automatic server-count publishing to top.gg is active.');
  return () => clearIv(handle);
}
