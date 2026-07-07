// src/commands/helpers.ts — helpers partilhados (locale de interface, reply efémero, permissões de convite, formatação de duração) extraídos de index.ts (plano 015).
import {
  PermissionsBitField,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { BotDeps } from '../bot/deps';
import { getGuildConfig } from '../store/guildConfig';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../i18n/index';

/**
 * Locale da INTERFACE para uma interacao. Le `guild_config.locale` da guild; em
 * DMs (guildId null) ou se a leitura falhar por qualquer motivo, devolve
 * DEFAULT_LOCALE ('en'). NUNCA lanca — uma falha a ler a config nunca deve partir
 * a resposta/erro que o utilizador recebe (isto e chamado inclusive no catch de
 * handleInteraction). Colapsa o padrao repetido `i.guildId ? ...locale : 'en'`.
 */
export function localeFor(deps: BotDeps, guildId: string | null | undefined): string {
  if (!guildId) return DEFAULT_LOCALE;
  try {
    return getGuildConfig(deps.db, guildId).locale;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/**
 * Locale da INTERFACE para uma resposta PER-UTILIZADOR (ephemeral). O Discord
 * envia o idioma do CLIENTE de quem clicou em `interaction.locale` (ex. 'pt-BR',
 * 'en-US', 'es-ES'); assim cada utilizador ve a UI na SUA lingua, sem depender do
 * locale configurado na guild.
 *
 * Resolucao (nunca lanca — como localeFor):
 *   1. Normaliza `interaction.locale` para o codigo base: parte antes do '-' em
 *      minusculas ('pt-BR'->'pt', 'en-US'->'en', 'es-419'->'es', 'zh-CN'->'zh',
 *      'sv-SE'->'sv'; um codigo ja base como 'fr' mapeia para si proprio). Uma
 *      regra generica cobre TODAS as variantes do Discord — sem casos especiais.
 *   2. Se o codigo base estiver em SUPPORTED_LOCALES -> usa-o.
 *   3. Senao (lingua do Discord que ainda nao suportamos, ou locale ausente) ->
 *      cai no locale configurado da GUILD (localeFor), que por sua vez cai em
 *      DEFAULT_LOCALE. Assim /config language continua a ser o fallback partilhado.
 */
export function localeForUser(
  deps: BotDeps,
  interaction: { locale?: string | null; guildId?: string | null },
): string {
  const raw = interaction?.locale;
  if (raw) {
    const base = raw.split('-')[0].toLowerCase();
    if ((SUPPORTED_LOCALES as readonly string[]).includes(base)) {
      return base;
    }
  }
  // Lingua do Discord nao suportada / ausente -> fallback para a guild (e default).
  return localeFor(deps, interaction?.guildId);
}

/**
 * Permissoes minimas que o Vozen precisa no servidor onde for convidado, derivadas
 * dos 5 bits nomeados via PermissionsBitField (NAO um numero magico):
 *  - Connect/Speak       -> entrar e falar nos canais de voz (o core do bot)
 *  - ViewChannel         -> ver os canais (texto e voz)
 *  - SendMessages        -> responder no canal de texto
 *  - ReadMessageHistory  -> ler o historico do canal de auto-leitura
 * Exportado como string (representacao do bigint) porque e isso que o parametro
 * `permissions` do URL OAuth2 espera. Derivado e testavel: o teste recomputa o
 * mesmo inteiro a partir dos bits, por isso deixar cair um bit aqui parte o teste.
 */
export const INVITE_PERMISSIONS: string = new PermissionsBitField([
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  // EmbedLinks: o bot responde quase tudo em EMBEDS (ajuda, stats, jogos, setup).
  // Sem esta permissão o Discord NÃO renderiza os embeds do bot em canais onde o
  // @everyone não a tenha. Reações/anexos NÃO entram: o código não usa .react() nem
  // envia ficheiros (auditado).
  PermissionFlagsBits.EmbedLinks,
  // Threads dos jogos (/game): o Vozen cria uma thread descartável por partida, escreve
  // nela e apaga-a no fim. Sem estas, o jogo cai no fallback (joga no próprio canal);
  // sem ManageThreads a thread não é apagada (auto-arquiva). Servidores já convidados
  // não têm estas permissões até re-convidarem — o fallback trata disso.
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.ManageThreads,
]).bitfield.toString();

export async function reply(i: ChatInputCommandInteraction, content: string): Promise<void> {
  await i.reply({ content, flags: MessageFlags.Ephemeral });
}

/**
 * Prefixo de locale a partir de um nome de modelo Piper: a parte inicial ate ao
 * primeiro '_' inclusive (ex. 'en_US-amy-medium' -> 'en_', 'pt_PT-tugao' -> 'pt_').
 * Se nao houver '_', devolve '' (o laughterFor cai no fallback "hahaha"). PURO.
 * E o MESMO formato de prefixo usado em LANG_TO_PREFIX / pickVoice, para que
 * laughterFor(prefix) e a escolha de voz falem a mesma lingua.
 */
export function localePrefixOf(model: string): string {
  const us = model.indexOf('_');
  return us === -1 ? '' : model.slice(0, us + 1);
}

/**
 * Formata uma duração em segundos como "2d 3h 15m" (omite unidades a zero à cabeça;
 * < 1 min -> "<1m"). Universal (letras d/h/m), a frase à volta é que é localizada. PURA.
 */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.length ? parts.join(' ') : '<1m';
}
