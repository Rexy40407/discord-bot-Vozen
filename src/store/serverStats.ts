// src/store/serverStats.ts
//
// Agregação de ESTATÍSTICAS DO SERVIDOR (perk Premium /serverstats). Compliance: SÓ agrega
// dados que o bot JÁ guarda (talk_stats + game_score) — sem recolha nova; "top-tagarelas"
// é dado por-utilizador já disclosed e já apagável por /privacy erase. Ver
// docs/COMPLIANCE-VAGA5.md · Stats. PURA/determinista (dado db + now); reutiliza
// getTopSpeakers + getLeaderboard, sem SQL novo.

import type Database from 'better-sqlite3';
import { getTopSpeakers, type TalkRow } from './talkStats';
import { getLeaderboard, type ScoreRow } from './gameScore';

export interface ServerStats {
  /** Total de mensagens que o Vozen leu neste servidor (soma de spoken_count). */
  totalMessages: number;
  /** Nº de pessoas com pelo menos 1 mensagem lida. */
  activeSpeakers: number;
  /** Maior streak de dias VIVO no servidor agora (0 se ninguém). */
  topStreak: number;
  /** Top N tagarelas (por streak vivo, desempate por contagem). */
  topSpeakers: TalkRow[];
  /** Total de pontos de minijogos (soma de points). */
  gamePoints: number;
  /** Total de partidas vencidas (soma de wins). */
  gameWins: number;
  /** Nº de jogadores com pontuação. */
  gamePlayers: number;
  /** Top N jogadores (por pontos, desempate por vitórias). */
  topPlayers: ScoreRow[];
}

// Limite defensivo ao varrer as linhas para os totais (servidores enormes). Muito acima de
// qualquer leaderboard real; evita materializar arrays gigantes num só servidor patológico.
const SCAN_CAP = 5000;

/**
 * Monta as estatísticas agregadas de `guildId`. `limit` = tamanho dos tops mostrados.
 * Os TOTAIS (mensagens, falantes, pontos, jogadores) varrem todas as linhas (até SCAN_CAP);
 * os TOPS são as primeiras `limit` já ordenadas. `now` injetável (streak vivo depende do dia).
 */
export function buildServerStats(
  db: Database.Database,
  guildId: string,
  now: Date,
  limit = 5,
): ServerStats {
  const speakers = getTopSpeakers(db, guildId, now, SCAN_CAP); // todas, já ordenadas
  const players = getLeaderboard(db, guildId, SCAN_CAP); // todas, já ordenadas

  return {
    totalMessages: speakers.reduce((a, s) => a + s.count, 0),
    activeSpeakers: speakers.length,
    topStreak: speakers.length ? speakers[0].streak : 0, // ordenado por streak desc
    topSpeakers: speakers.slice(0, limit),
    gamePoints: players.reduce((a, p) => a + p.points, 0),
    gameWins: players.reduce((a, p) => a + p.wins, 0),
    gamePlayers: players.length,
    topPlayers: players.slice(0, limit),
  };
}
