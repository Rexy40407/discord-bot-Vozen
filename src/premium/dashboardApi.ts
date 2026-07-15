// src/premium/dashboardApi.ts
//
// Núcleo do DASHBOARD WEB de configuração da guild (login com Discord no site).
// Segurança (ver docs/COMPLIANCE-VAGA5.md · Dashboard):
//  - A identidade e a lista de servidores vêm SEMPRE da Discord com o Bearer token do
//    utilizador (scope `guilds`) — nunca confiamos num ID vindo do cliente.
//  - Só quem tem MANAGE_GUILD (ou ADMINISTRATOR) NESSE servidor E onde o bot está presente
//    pode ler/escrever a config. Um `guildId` fora desse conjunto -> null (não vaza nada).
//  - A escrita é WHITELISTED (só os DASHBOARD_FIELDS) e passa pelo setter do store
//    (`setGuildConfig`) que invalida a cache write-through e impõe os defaults/limites —
//    nunca SQL direto. Injetar `ttsChannelId`/`enabled`/etc. é ignorado.
// Puro/testável (fetch injetável); isolado do servidor HTTP (montado em kofiWebhook.ts).

import type Database from 'better-sqlite3';
import { getGuildConfig, setGuildConfig, type GuildConfig } from '../store/guildConfig';
import { SUPPORTED_LOCALES } from '../i18n/index';

/** Toggles booleanos que o dashboard expõe (subconjunto de GuildConfig). */
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

/** Todos os campos editáveis pelo dashboard (whitelist). */
export const DASHBOARD_FIELDS = [...BOOL_FIELDS, 'maxChars', 'ratePerMin', 'locale'] as const;
type DashboardField = (typeof DASHBOARD_FIELDS)[number];

/** A vista da config que o dashboard lê/escreve — só a whitelist. */
export type DashboardConfig = Pick<GuildConfig, DashboardField>;

// Limites de sanidade (espelham os do bot; o setter aplica os defaults do resto).
const MAX_CHARS_MIN = 1;
const MAX_CHARS_MAX = 2000;
const RATE_MIN = 1;
const RATE_MAX = 120;

const clampInt = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Math.floor(v)));

/**
 * Filtra um corpo cru do cliente para um patch SEGURO: só campos da whitelist, booleans
 * coagidos, números limitados a intervalos sãos, locale validado. Tudo o resto (ex.
 * `ttsChannelId`, `enabled`, chaves desconhecidas) é DESCARTADO. PURA/testável.
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

/** Um servidor gerível para o seletor do dashboard. */
export interface ManageableGuild {
  id: string;
  name: string;
  icon: string | null;
}

export interface DashboardApiDeps {
  db: Database.Database;
  now: () => number;
  /** Injetável para testes; em produção é o fetch global do Node. */
  fetchImpl: typeof fetch;
  /** true se o BOT está nesta guild (client.guilds.cache.has). */
  botHasGuild: (guildId: string) => boolean;
  /** TTL da cache token->servidores geríveis (ms). Default 60s. */
  guildsTtlMs?: number;
  /** Limite defensivo da cache. Default 512. */
  cacheMaxEntries?: number;
  logError?: (m: string, err: unknown) => void;
}

export interface DashboardApi {
  /** Servidores onde o utilizador é admin E o bot está. null = token inválido. */
  listGuilds(token: string): Promise<ManageableGuild[] | null>;
  /** Config (whitelist) de um servidor gerível. null = token inválido OU não autorizado. */
  getConfig(token: string, guildId: string): Promise<DashboardConfig | null>;
  /** Aplica um patch (whitelist) e devolve a config nova. null = não autorizado. */
  saveConfig(token: string, guildId: string, patch: unknown): Promise<DashboardConfig | null>;
}

const DISCORD_GUILDS = 'https://discord.com/api/v10/users/@me/guilds';
const MANAGE_GUILD = 0x20n; // 1<<5
const ADMINISTRATOR = 0x8n; // 1<<3
const FETCH_TIMEOUT_MS = 5_000;

/** Projeta a config completa na vista do dashboard (só a whitelist). */
function projectConfig(cfg: GuildConfig): DashboardConfig {
  const out = {} as DashboardConfig;
  for (const f of DASHBOARD_FIELDS) (out as Record<string, unknown>)[f] = cfg[f];
  return out;
}

/** Tem MANAGE_GUILD ou ADMINISTRATOR (ou é dono)? `permissions` é string dec/hex da Discord. */
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

  // Busca à Discord os servidores geríveis (MANAGE_GUILD/ADMIN + bot presente). Cacheia por
  // token (TTL curto). null => token inválido / erro (o chamador trata como 401).
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
      // res.ok false (ex. 401) => guilds fica null (token inválido/expirado).
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
    if (guilds === null) return null; // token inválido
    return guilds.some((g) => g.id === guildId);
  }

  return {
    listGuilds: (token) => fetchManageable(token),

    async getConfig(token, guildId) {
      const ok = await authorize(token, guildId);
      if (!ok) return null; // null (inválido) ou false (não autorizado) -> null
      return projectConfig(getGuildConfig(deps.db, guildId));
    },

    async saveConfig(token, guildId, patch) {
      const ok = await authorize(token, guildId);
      if (!ok) return null;
      const clean = sanitizePatch(patch);
      // setGuildConfig aceita Partial<GuildConfig>; os DASHBOARD_FIELDS são um subconjunto.
      // Invalida a cache write-through e impõe os defaults do resto (nunca SQL direto).
      setGuildConfig(deps.db, guildId, clean);
      return projectConfig(getGuildConfig(deps.db, guildId));
    },
  };
}
