import type Database from 'better-sqlite3';

// Apelido FONÉTICO por-(guild,user) para o anúncio do xsaid: nomes cheios de emojis/
// símbolos ("🔥xX_Pro_Xx🔥") são ilegíveis em voz alta; o utilizador define aqui como
// quer ser CHAMADO. Vazio/ausente => cai no displayName (sanitizado).

export function getNickname(
  db: Database.Database,
  guildId: string,
  userId: string,
): string | null {
  const row = db
    .prepare('SELECT nickname FROM user_nickname WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as { nickname: string } | undefined;
  return row ? row.nickname : null;
}

export function setNickname(
  db: Database.Database,
  guildId: string,
  userId: string,
  nickname: string,
): void {
  db.prepare(
    `INSERT INTO user_nickname (guild_id, user_id, nickname)
     VALUES (?, ?, ?)
     ON CONFLICT(guild_id, user_id) DO UPDATE SET nickname = excluded.nickname`,
  ).run(guildId, userId, nickname);
}

export function clearNickname(db: Database.Database, guildId: string, userId: string): void {
  db.prepare('DELETE FROM user_nickname WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}
