// src/store/dataLifecycle.ts
//
// Ciclo de vida dos dados para CONFORMIDADE (RGPD / Política de Desenvolvedor do Discord
// §5(b)): duas operações — purgar os dados de um SERVIDOR que removeu o bot, e apagar
// TODOS os dados de um UTILIZADOR (direito ao esquecimento).
//
// FONTE ÚNICA DE VERDADE: as 4 listas abaixo categorizam cada tabela. Uma tabela nova com
// `guild_id`/`user_id` TEM de entrar numa delas — senão `dataLifecycle.test.ts` (rot-guard)
// FALHA. A distinção purga/erase vs. RETIDA não é derivável do schema (uma tabela financeira
// tem `user_id` na mesma), por isso é explícita e revista à mão.
import type Database from 'better-sqlite3';
import { invalidateGuild, invalidateUser } from './cache';
import { deleteClone, deleteClonesByTarget } from './voiceClone';
import { deleteUserGcloudUsage } from './gcloudUsage';

// ── Tabelas com guild_id ─────────────────────────────────────────────────────
/** Apagadas quando um servidor remove o bot (após o grace period). Conteúdo/config/stats. */
export const GUILD_PURGE_TABLES = [
  'user_voice',
  'guild_config',
  'blocklist',
  'pronunciation',
  'tts_optout',
  'user_nickname',
  'game_score',
  'user_birthday',
  'talk_stats',
  'user_effect',
  'voice_presence',
  'stt_consent',
  'guild_departed', // a própria marca de saída (auto-limpeza ao purgar o servidor)
] as const;

/**
 * RETIDAS deliberadamente apesar de terem guild_id: registo financeiro/entitlement pago.
 * A compra é do UTILIZADOR e segue-o; o histórico tem retenção legal. Purgar aqui apagaria
 * prova de pagamento e libertaria seats pagos.
 */
export const GUILD_RETAINED_TABLES = ['premium_guild', 'premium_pass_activation'] as const;

// ── Tabelas com user_id ──────────────────────────────────────────────────────
/** Apagadas por `/privacy erase` (dados pessoais). user_clone inclui o .wav biométrico. */
export const USER_ERASE_TABLES = [
  'user_voice',
  'tts_optout',
  'user_nickname',
  'game_score',
  'user_birthday',
  'talk_stats',
  'user_effect',
  'user_abbreviation',
  'pronunciation_user',
  'user_clone',
  'stt_consent',
  'vote_reward',
] as const;

/**
 * RETIDAS: entitlement pago + registo financeiro. O RGPD tem uma exceção para dados
 * necessários a cumprir um contrato (o premium que a pessoa paga) e retenção legal do
 * histórico. `/privacy erase` apaga os dados pessoais mas não revoga o que foi comprado.
 */
export const USER_RETAINED_TABLES = [
  'premium_user',
  'premium_pass',
  'premium_pass_activation',
] as const;

// ── Cobertura para o rot-guard ALARGADO (colunas-identificador não-standard) ──────────
// O rot-guard antigo só via colunas literalmente `user_id`/`guild_id`. Um ID de utilizador
// guardado sob OUTRO nome (discord_id, key, created_by…) escapava-lhe E à eliminação. O
// guard alargado (ver dataLifecycle.test.ts) exige que TODA a tabela com uma coluna em
// forma de identificador esteja numa das listas acima OU numa das duas abaixo.

/**
 * Tabelas apagadas por `eraseUser` MAS não via `USER_ERASE_TABLES` (a chave NÃO é
 * `user_id`): apagadas à mão dentro da transação do erase. Guardam o ID do utilizador
 * sob outro nome, por isso o guard alargado exige-as aqui para não escaparem ao erase.
 */
export const USER_ERASE_BESPOKE = ['kofi_supporter', 'gcloud_usage'] as const;

/**
 * Tabelas com uma coluna em forma de identificador que NÃO são dados pessoais
 * elimináveis — ledgers financeiros / de idempotência deliberadamente RETIDOS. Estar
 * aqui é uma decisão consciente (revista à mão); o guard alargado aceita-as.
 */
export const LIFECYCLE_REVIEWED_EXEMPT = [
  'premium_code', // ledger de códigos: created_by/redeemed_by = prova de compra/resgate, retido
  'kofi_transaction', // ledger de idempotência: transaction_id do Ko-fi, não um ID de utilizador
  'kofi_pending', // compras pendentes, purgadas por TTL (startPendingPurgeJob); tx id + email_hash
] as const;

/**
 * Apaga TODAS as linhas guild-scoped de um servidor (não toca nas retidas). Transação:
 * ou apaga tudo, ou nada. Invalida a cache guild-keyed no fim.
 */
export function purgeGuild(db: Database.Database, guildId: string): void {
  const run = db.transaction((gid: string) => {
    for (const table of GUILD_PURGE_TABLES) {
      db.prepare(`DELETE FROM ${table} WHERE guild_id = ?`).run(gid);
    }
  });
  run(guildId);
  invalidateGuild(db, guildId);
}

export interface EraseResult {
  /** Caminhos de amostras de voz (.wav) a apagar do disco pelo chamador. */
  removedSamplePaths: string[];
}

/**
 * Apaga TODOS os dados pessoais de um utilizador em qualquer servidor (não toca no
 * financeiro/entitlement). Trata os clones à parte (via voiceClone): o auto-clone do
 * próprio E os clones feitos a partir da VOZ dele por outras pessoas (dados biométricos
 * dele → revogados). Devolve os caminhos dos .wav para o chamador os apagar do disco.
 */
export function eraseUser(db: Database.Database, userId: string): EraseResult {
  const removedSamplePaths: string[] = [];
  const run = db.transaction((uid: string) => {
    for (const table of USER_ERASE_TABLES) {
      // user_clone é tratado abaixo (inclui .wav + revogação de clones da voz dele).
      if (table === 'user_clone') continue;
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(uid);
    }
    // BESPOKE (chave != user_id): kofi_supporter guarda o Discord ID em `discord_id`;
    // gcloud_usage guarda-o em `key` para scope user/pass (pool pessoal/do passe). As
    // linhas scope='guild' do gcloud_usage são retidas e purgadas por TTL
    // (purgeOldGcloudUsage), não são dado pessoal apagável por este erase.
    db.prepare('DELETE FROM kofi_supporter WHERE discord_id = ?').run(uid);
    deleteUserGcloudUsage(db, uid);
  });
  run(userId);

  // Clones: o do próprio (dono == user) e os que outros fizeram da voz DELE (target == user).
  const own = deleteClone(db, userId);
  if (own) removedSamplePaths.push(own);
  for (const { samplePath } of deleteClonesByTarget(db, userId)) {
    removedSamplePaths.push(samplePath);
  }

  invalidateUser(db, userId);
  return { removedSamplePaths };
}
