import type Database from 'better-sqlite3';

/** Motor de TTS escolhido pelo utilizador: 'google' (gTTS, default) ou 'piper'. */
export type UserEngine = 'google' | 'piper';

interface UserVoiceRow {
  voice_model: string;
  speed: number;
  engine: string | null;
}

export function getUserVoice(
  db: Database.Database,
  guildId: string,
  userId: string,
): { model: string; speed: number; engine: UserEngine } | null {
  const row = db
    .prepare('SELECT voice_model, speed, engine FROM user_voice WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as UserVoiceRow | undefined;
  if (!row) return null;
  // Coluna NOT NULL DEFAULT 'google'; qualquer valor != 'piper' cai em 'google' (seguro).
  return { model: row.voice_model, speed: row.speed, engine: row.engine === 'piper' ? 'piper' : 'google' };
}

export function setUserVoice(
  db: Database.Database,
  guildId: string,
  userId: string,
  model: string,
  speed: number,
  engine: UserEngine = 'google',
): void {
  db.prepare(
    `INSERT INTO user_voice (guild_id, user_id, voice_model, speed, engine)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(guild_id, user_id)
     DO UPDATE SET voice_model = excluded.voice_model, speed = excluded.speed, engine = excluded.engine`,
  ).run(guildId, userId, model, speed, engine);
}

export function resetUserVoice(
  db: Database.Database,
  guildId: string,
  userId: string,
): void {
  db.prepare('DELETE FROM user_voice WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}
