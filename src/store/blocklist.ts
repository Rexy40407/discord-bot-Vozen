import type Database from 'better-sqlite3';

interface WordRow {
  word: string;
}

export function getBlocklist(db: Database.Database, guildId: string): string[] {
  const rows = db
    .prepare('SELECT word FROM blocklist WHERE guild_id = ? ORDER BY word ASC')
    .all(guildId) as WordRow[];
  return rows.map((r) => r.word);
}

export function addBlockword(db: Database.Database, guildId: string, word: string): void {
  db.prepare(
    `INSERT INTO blocklist (guild_id, word) VALUES (?, ?)
     ON CONFLICT(guild_id, word) DO NOTHING`,
  ).run(guildId, word);
}

export function removeBlockword(db: Database.Database, guildId: string, word: string): void {
  db.prepare('DELETE FROM blocklist WHERE guild_id = ? AND word = ?').run(guildId, word);
}
