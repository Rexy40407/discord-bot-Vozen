import type Database from 'better-sqlite3';

// 24/7 in-call (Premium): persistência do canal de voz do bot por guild, para o repor
// no arranque (sobrevive a restarts/deploys). Ver a tabela voice_presence em db.ts e o
// planeamento puro em src/voice/rejoin.ts. Só é escrito para servidores Premium (o gate
// vive em createVoiceSession); estas funções são o acesso cru à tabela.

export interface VoicePresenceRow {
  guildId: string;
  channelId: string;
  updatedAt: number;
}

/** Regista/atualiza (upsert) o canal onde o bot está nesta guild. */
export function rememberVoicePresence(
  db: Database.Database,
  guildId: string,
  channelId: string,
  now: number,
): void {
  db.prepare(
    `INSERT INTO voice_presence (guild_id, channel_id, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id, updated_at = excluded.updated_at`,
  ).run(guildId, channelId, now);
}

/** Esquece a presença desta guild. Idempotente (no-op se não existir). */
export function forgetVoicePresence(db: Database.Database, guildId: string): void {
  db.prepare('DELETE FROM voice_presence WHERE guild_id = ?').run(guildId);
}

/** Todas as presenças persistidas (para o rejoin no arranque). */
export function listVoicePresence(db: Database.Database): VoicePresenceRow[] {
  const rows = db.prepare('SELECT guild_id, channel_id, updated_at FROM voice_presence').all() as {
    guild_id: string;
    channel_id: string;
    updated_at: number;
  }[];
  return rows.map((r) => ({
    guildId: r.guild_id,
    channelId: r.channel_id,
    updatedAt: r.updated_at,
  }));
}
