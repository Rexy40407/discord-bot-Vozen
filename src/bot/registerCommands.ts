import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REST, Routes } from 'discord.js';
import { commandDefs, ownerCommandDefs } from '../commands/index';
import { loadConfig } from '../config/index';
import { log } from '../logging/logger';

/** Fingerprint estável do conjunto de comandos (para detetar mudanças entre boots). */
export function commandsFingerprint(defs: unknown): string {
  return createHash('sha1').update(JSON.stringify(defs)).digest('hex');
}

interface RegisterState {
  clientId: string;
  fingerprint: string;
  at: string;
}

/**
 * true se o registo pode ser SALTADO: o estado gravado bate certo com o fingerprint
 * atual (mesma app, mesmos comandos). Qualquer erro de leitura => false (regista).
 */
export function shouldSkipRegister(
  stateFile: string,
  clientId: string,
  fingerprint: string,
): boolean {
  try {
    const prev = JSON.parse(readFileSync(stateFile, 'utf8')) as RegisterState;
    return prev.clientId === clientId && prev.fingerprint === fingerprint;
  } catch {
    return false;
  }
}

/** Grava o estado do registo (best-effort: falhar aqui só custa um re-PUT no próximo boot). */
export function saveRegisterState(stateFile: string, clientId: string, fingerprint: string): void {
  try {
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(
      stateFile,
      JSON.stringify({
        clientId,
        fingerprint,
        at: new Date().toISOString(),
      } satisfies RegisterState),
    );
  } catch (err) {
    log.warn(
      '[register] não consegui gravar o estado do registo (re-registará no próximo arranque)',
      err,
    );
  }
}

/**
 * Sincroniza os slash commands globais. Com `stateFile`, o PUT global só acontece
 * quando o conjunto de comandos MUDOU desde o último registo (fingerprint):
 *  - o PUT global é fortemente rate-limited e tem quota diária — reinícios
 *    frequentes (dev) queimavam-na à toa;
 *  - re-registar bumpa a versão dos comandos e invalida a cache do cliente
 *    Discord, o que coincide com falhas transitórias de autocomplete
 *    ("Falha ao carregar opções") logo após um restart.
 * FORCE_REGISTER=1 ignora o estado e regista sempre. Devolve true se registou.
 */
export async function registerCommands(
  token: string,
  clientId: string,
  opts: { stateFile?: string } = {},
): Promise<boolean> {
  const fingerprint = commandsFingerprint(commandDefs);
  if (
    opts.stateFile &&
    process.env.FORCE_REGISTER !== '1' &&
    shouldSkipRegister(opts.stateFile, clientId, fingerprint)
  ) {
    log.info(`[register] comandos inalterados (${fingerprint.slice(0, 8)}) — PUT global saltado.`);
    return false;
  }
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: commandDefs });
  log.info(`[register] ${commandDefs.length} comandos registados globalmente.`);
  if (opts.stateFile) saveRegisterState(opts.stateFile, clientId, fingerprint);
  return true;
}

/**
 * Regista os comandos OWNER-ONLY como comandos de GUILD na `guildId` de controlo — NÃO
 * globais. Assim o público nem os vê no picker (1.ª camada de defesa; a 2.ª é o gate por
 * dono no handler). PUT de guild não sofre o rate-limit do global e propaga na hora.
 */
export async function registerOwnerCommands(
  token: string,
  clientId: string,
  guildId: string,
): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: ownerCommandDefs });
  log.info(`[register] ${ownerCommandDefs.length} comando(s) owner na guild ${guildId}.`);
}

// arranque quando corrido via `npm run register`
if (process.argv[1] && process.argv[1].endsWith('registerCommands.ts')) {
  const cfg = loadConfig();
  const stateFile = join(dirname(cfg.dbPath), 'commands-state.json');
  registerCommands(cfg.token, cfg.clientId, { stateFile }).catch((err) => {
    log.error('[register] falhou', err);
    process.exit(1);
  });
}
