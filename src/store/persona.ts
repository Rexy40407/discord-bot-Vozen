import type Database from 'better-sqlite3';
import { isPersona, type Persona } from '../textCleaning/personas';

// Persona de fala por-(guild,user): o "estilo" com que o Voxi lê as mensagens dessa
// pessoa (pirata, uwu, Yoda...). Ausente/'none' => leitura normal. Guardada como TEXT;
// qualquer valor inválido lê-se como 'none' (seguro contra dados corrompidos).

export function getPersona(db: Database.Database, guildId: string, userId: string): Persona {
  const row = db
    .prepare('SELECT persona FROM user_persona WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as { persona: string } | undefined;
  if (!row || !isPersona(row.persona)) return 'none';
  return row.persona;
}

export function setPersona(
  db: Database.Database,
  guildId: string,
  userId: string,
  persona: Persona,
): void {
  // 'none' não precisa de linha — apagar mantém a tabela pequena e é equivalente à leitura.
  if (persona === 'none') {
    clearPersona(db, guildId, userId);
    return;
  }
  db.prepare(
    `INSERT INTO user_persona (guild_id, user_id, persona)
     VALUES (?, ?, ?)
     ON CONFLICT(guild_id, user_id) DO UPDATE SET persona = excluded.persona`,
  ).run(guildId, userId, persona);
}

export function clearPersona(db: Database.Database, guildId: string, userId: string): void {
  db.prepare('DELETE FROM user_persona WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}
