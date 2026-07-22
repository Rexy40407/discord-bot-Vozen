import type Database from 'better-sqlite3';
import { cached, invalidate } from './cache';

/**
 * Per-channel policy overrides. Nullable fields deliberately mean "inherit the guild setting";
 * this keeps newly-created profiles inert until an administrator explicitly enables a behaviour.
 * No message, audio, member, or queue content is stored here.
 */
export interface ChannelProfile {
  guildId: string;
  channelId: string;
  autoRead: boolean | null;
  translationEnabled: boolean | null;
  defaultVoice: string | null;
}

export const MAX_CHANNEL_PROFILES_PER_GUILD = 25;

interface Row {
  guild_id: string;
  channel_id: string;
  auto_read: number | null;
  translation_enabled: number | null;
  default_voice: string | null;
}

function rowToProfile(row: Row): ChannelProfile {
  return {
    guildId: row.guild_id,
    channelId: row.channel_id,
    autoRead: row.auto_read === null ? null : row.auto_read === 1,
    translationEnabled: row.translation_enabled === null ? null : row.translation_enabled === 1,
    defaultVoice: row.default_voice || null,
  };
}

export function listChannelProfiles(db: Database.Database, guildId: string): ChannelProfile[] {
  return cached(db, 'channel_profile', guildId, () =>
    (
      db
        .prepare(
          `SELECT guild_id, channel_id, auto_read, translation_enabled, default_voice
           FROM channel_profile WHERE guild_id = ? ORDER BY channel_id`,
        )
        .all(guildId) as Row[]
    ).map(rowToProfile),
  );
}

export function getChannelProfile(
  db: Database.Database,
  guildId: string,
  channelId: string,
): ChannelProfile | null {
  return (
    listChannelProfiles(db, guildId).find((profile) => profile.channelId === channelId) ?? null
  );
}

export type ChannelProfilePatch = Pick<
  ChannelProfile,
  'autoRead' | 'translationEnabled' | 'defaultVoice'
>;

/** Returns false instead of silently growing unbounded profile state. */
export function saveChannelProfile(
  db: Database.Database,
  guildId: string,
  channelId: string,
  patch: ChannelProfilePatch,
): boolean {
  const existing = getChannelProfile(db, guildId, channelId);
  if (!existing && listChannelProfiles(db, guildId).length >= MAX_CHANNEL_PROFILES_PER_GUILD)
    return false;
  const next = { ...existing, ...patch } as ChannelProfilePatch;
  db.prepare(
    `INSERT INTO channel_profile (guild_id, channel_id, auto_read, translation_enabled, default_voice)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(guild_id, channel_id) DO UPDATE SET
       auto_read = excluded.auto_read,
       translation_enabled = excluded.translation_enabled,
       default_voice = excluded.default_voice`,
  ).run(
    guildId,
    channelId,
    next.autoRead === null ? null : Number(next.autoRead),
    next.translationEnabled === null ? null : Number(next.translationEnabled),
    next.defaultVoice || null,
  );
  invalidate(db, 'channel_profile', guildId);
  return true;
}

export function deleteChannelProfile(
  db: Database.Database,
  guildId: string,
  channelId: string,
): void {
  db.prepare('DELETE FROM channel_profile WHERE guild_id = ? AND channel_id = ?').run(
    guildId,
    channelId,
  );
  invalidate(db, 'channel_profile', guildId);
}
