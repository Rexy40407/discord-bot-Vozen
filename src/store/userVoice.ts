import type Database from 'better-sqlite3';

interface UserVoiceRow {
  voice_model: string;
  speed: number;
}

export function getUserVoice(
  db: Database.Database,
  guildId: string,
  userId: string,
): { model: string; speed: number } | null {
  const row = db
    .prepare('SELECT voice_model, speed FROM user_voice WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as UserVoiceRow | undefined;
  if (!row) return null;
  return { model: row.voice_model, speed: row.speed };
}

export function setUserVoice(
  db: Database.Database,
  guildId: string,
  userId: string,
  model: string,
  speed: number,
): void {
  db.prepare(
    `INSERT INTO user_voice (guild_id, user_id, voice_model, speed)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(guild_id, user_id)
     DO UPDATE SET voice_model = excluded.voice_model, speed = excluded.speed`,
  ).run(guildId, userId, model, speed);
}

export function resetUserVoice(
  db: Database.Database,
  guildId: string,
  userId: string,
): void {
  db.prepare('DELETE FROM user_voice WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}
