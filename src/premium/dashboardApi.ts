// src/premium/dashboardApi.ts
//
// Core of the WEB DASHBOARD for guild configuration (login with Discord on the site).
// Security (see docs/COMPLIANCE-VAGA5.md · Dashboard):
//  - The identity and the server list ALWAYS come from Discord with the user's Bearer
//    token (scope `guilds`) — we never trust an ID coming from the client.
//  - Only someone with MANAGE_GUILD (or ADMINISTRATOR) IN THAT server AND where the bot is
//    present can read/write the config. A `guildId` outside that set -> null (leaks nothing).
//  - Writes are WHITELISTED (only the DASHBOARD_FIELDS) and go through the store setter
//    (`setGuildConfig`), which invalidates the write-through cache and enforces the
//    defaults/limits — never direct SQL. Injecting `ttsChannelId`/`enabled`/etc. is ignored.
// Pure/testable (injectable fetch); isolated from the HTTP server (mounted in kofiWebhook.ts).

import type Database from 'better-sqlite3';
import { getGuildConfig, setGuildConfig, type GuildConfig } from '../store/guildConfig';
import { SUPPORTED_LOCALES } from '../i18n/index';

/** Boolean toggles the dashboard exposes (subset of GuildConfig). */
const BOOL_FIELDS = [
  'autoread',
  'xsaid',
  'autojoin',
  'readBots',
  'textInVoice',
  'antispam',
  'streakAnnounce',
  'soundboard',
  'greetOnJoin',
] as const;

/** All fields editable by the dashboard (whitelist). */
export const DASHBOARD_FIELDS = [...BOOL_FIELDS, 'maxChars', 'ratePerMin', 'locale'] as const;
type DashboardField = (typeof DASHBOARD_FIELDS)[number];

/** The config view the dashboard reads/writes — only the whitelist. */
export type DashboardConfig = Pick<GuildConfig, DashboardField>;

// Sanity limits (mirror the bot's; the setter applies the defaults for the rest).
const MAX_CHARS_MIN = 1;
const MAX_CHARS_MAX = 2000;
const RATE_MIN = 1;
const RATE_MAX = 120;

const clampInt = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Math.floor(v)));

/**
 * Filters a raw client body into a SAFE patch: only whitelist fields, coerced booleans,
 * numbers clamped to sane ranges, validated locale. Everything else (e.g.
 * `ttsChannelId`, `enabled`, unknown keys) is DISCARDED. PURE/testable.
 */
export function sanitizePatch(input: unknown): Partial<DashboardConfig> {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Partial<DashboardConfig> = {};
  for (const f of BOOL_FIELDS) {
    if (f in src) out[f] = Boolean(src[f]);
  }
  if (typeof src.maxChars === 'number' && Number.isFinite(src.maxChars)) {
    out.maxChars = clampInt(src.maxChars, MAX_CHARS_MIN, MAX_CHARS_MAX);
  }
  if (typeof src.ratePerMin === 'number' && Number.isFinite(src.ratePerMin)) {
    out.ratePerMin = clampInt(src.ratePerMin, RATE_MIN, RATE_MAX);
  }
  if (
    typeof src.locale === 'string' &&
    (SUPPORTED_LOCALES as readonly string[]).includes(src.locale)
  ) {
    out.locale = src.locale;
  }
  return out;
}

/** A manageable server for the dashboard selector. */
export interface ManageableGuild {
  id: string;
  name: string;
  icon: string | null;
}

export interface DashboardApiDeps {
  db: Database.Database;
  now: () => number;
  /** Injectable for tests; in production it is Node's global fetch. */
  fetchImpl: typeof fetch;
  /** true if the BOT is in this guild (client.guilds.cache.has). */
  botHasGuild: (guildId: string) => boolean;
  /** TTL of the token->manageable-servers cache (ms). Default 60s. */
  guildsTtlMs?: number;
  /** Defensive cache limit. Default 512. */
  cacheMaxEntries?: number;
  logError?: (m: string, err: unknown) => void;
}

export interface DashboardApi {
  /** Servers where the user is an admin AND the bot is present. null = invalid token. */
  listGuilds(token: string): Promise<ManageableGuild[] | null>;
  /** Config (whitelist) of a manageable server. null = invalid token OR not authorized. */
  getConfig(token: string, guildId: string): Promise<DashboardConfig | null>;
  /** Applies a patch (whitelist) and returns the new config. null = not authorized. */
  saveConfig(token: string, guildId: string, patch: unknown): Promise<DashboardConfig | null>;
}

const DISCORD_GUILDS = 'https://discord.com/api/v10/users/@me/guilds';
const MANAGE_GUILD = 0x20n; // 1<<5
const ADMINISTRATOR = 0x8n; // 1<<3
const FETCH_TIMEOUT_MS = 5_000;

/** Projects the full config into the dashboard view (only the whitelist). */
function projectConfig(cfg: GuildConfig): DashboardConfig {
  const out = {} as DashboardConfig;
  for (const f of DASHBOARD_FIELDS) (out as Record<string, unknown>)[f] = cfg[f];
  return out;
}

/** Has MANAGE_GUILD or ADMINISTRATOR (or is owner)? `permissions` is Discord's dec/hex string. */
function canManage(permissions: unknown, owner: unknown): boolean {
  if (owner === true) return true;
  if (typeof permissions !== 'string' && typeof permissions !== 'number') return false;
  let bits: bigint;
  try {
    bits = BigInt(permissions);
  } catch {
    return false;
  }
  return (bits & MANAGE_GUILD) !== 0n || (bits & ADMINISTRATOR) !== 0n;
}

export function createDashboardApi(deps: DashboardApiDeps): DashboardApi {
  const ttl = deps.guildsTtlMs ?? 60_000;
  const maxEntries = Math.max(1, Math.floor(deps.cacheMaxEntries ?? 512));
  const cache = new Map<string, { guilds: ManageableGuild[] | null; exp: number }>();

  function prune(now: number): void {
    for (const [k, v] of cache) if (v.exp <= now) cache.delete(k);
    while (cache.size >= maxEntries) {
      const oldest = cache.keys().next().value as string | undefined;
      if (!oldest) break;
      cache.delete(oldest);
    }
  }

  // Fetches from Discord the manageable servers (MANAGE_GUILD/ADMIN + bot present). Caches by
  // token (short TTL). null => invalid token / error (the caller treats it as 401).
  async function fetchManageable(token: string): Promise<ManageableGuild[] | null> {
    const now = deps.now();
    const hit = cache.get(token);
    if (hit && hit.exp > now) return hit.guilds;
    if (hit) cache.delete(token);
    prune(now);

    let guilds: ManageableGuild[] | null = null;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await deps.fetchImpl(DISCORD_GUILDS, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ac.signal,
      });
      if (res.ok) {
        const raw = (await res.json()) as unknown;
        const arr = Array.isArray(raw) ? raw : [];
        guilds = arr
          .filter((g): g is Record<string, unknown> => !!g && typeof g === 'object')
          .filter((g) => typeof g.id === 'string' && deps.botHasGuild(g.id))
          .filter((g) => canManage(g.permissions, g.owner))
          .map((g) => ({
            id: g.id as string,
            name: typeof g.name === 'string' ? g.name : (g.id as string),
            icon: typeof g.icon === 'string' ? g.icon : null,
          }));
      }
      // res.ok false (e.g. 401) => guilds stays null (invalid/expired token).
    } catch (err) {
      deps.logError?.('[dashboard] failed to list Discord guilds', err);
      guilds = null;
    } finally {
      clearTimeout(timer);
    }
    prune(now);
    cache.set(token, { guilds, exp: now + ttl });
    return guilds;
  }

  async function authorize(token: string, guildId: string): Promise<boolean | null> {
    const guilds = await fetchManageable(token);
    if (guilds === null) return null; // invalid token
    return guilds.some((g) => g.id === guildId);
  }

  return {
    listGuilds: (token) => fetchManageable(token),

    async getConfig(token, guildId) {
      const ok = await authorize(token, guildId);
      if (!ok) return null; // null (invalid) or false (not authorized) -> null
      return projectConfig(getGuildConfig(deps.db, guildId));
    },

    async saveConfig(token, guildId, patch) {
      const ok = await authorize(token, guildId);
      if (!ok) return null;
      const clean = sanitizePatch(patch);
      // setGuildConfig accepts Partial<GuildConfig>; the DASHBOARD_FIELDS are a subset.
      // Invalidates the write-through cache and enforces the defaults for the rest (never direct SQL).
      setGuildConfig(deps.db, guildId, clean);
      return projectConfig(getGuildConfig(deps.db, guildId));
    },
  };
}
