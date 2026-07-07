// src/commands/handlers/meta.ts — handlers informativos/de crescimento: /help, /invite, /vote, /uptime, /botstats, /topspeakers, /premium, /redeem (extraídos de index.ts, plano 015).
import {
  ChatInputCommandInteraction,
  GuildMember,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import type { BotDeps } from '../../bot/deps';
import { metrics } from '../../metrics';
import { brandEmbed } from '../../ui/theme';
import { getTopSpeakers } from '../../store/talkStats';
import {
  redeemCode,
  peekRedeemCodeKind,
  getGuildPremiumExpiry,
  getUserPremiumExpiry,
} from '../../store/premium';
import { t } from '../../i18n/index';
import { INVITE_PERMISSIONS, formatDuration, localeForUser, reply } from '../helpers';
import { commandDefs } from '../index';

/**
 * /topspeakers — ranking público de quem teve mais mensagens LIDAS pelo Vozen nesta guild,
 * com o streak (dias seguidos a falar) de cada um. Mesma renderização do game leaderboard
 * (<@id> + linhas i18n). Vazio -> mensagem a convidar a falar.
 */
export async function handleTopSpeakers(
  i: ChatInputCommandInteraction,
  deps: BotDeps,
): Promise<void> {
  const locale = localeForUser(deps, i);
  const rows = getTopSpeakers(deps.db, i.guildId!, 10);
  if (rows.length === 0) {
    await reply(i, t('topspeakers.empty', locale));
    return;
  }
  const lines = rows.map((r, idx) =>
    t('topspeakers.line', locale, {
      rank: idx + 1,
      user: r.userId,
      count: r.count,
      streak: r.streak,
    }),
  );
  await i.reply({ content: `${t('topspeakers.title', locale)}\n${lines.join('\n')}` });
}

/** /premium — estado das assinaturas (servidor + próprio utilizador) + como obter. */
export async function handlePremium(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const now = Date.now();
  // Discord renderiza <t:SEGUNDOS:D> como data localizada por-utilizador.
  const stamp = (ms: number): string => `<t:${Math.floor(ms / 1000)}:D>`;

  const gExp = getGuildPremiumExpiry(deps.db, i.guildId!);
  const uExp = getUserPremiumExpiry(deps.db, i.user.id);
  const gActive = gExp !== null && gExp > now;
  const uActive = uExp !== null && uExp > now;

  const serverLine = gActive
    ? t('premium.lineServerActive', locale, { date: stamp(gExp) })
    : t('premium.lineServerFree', locale);
  const youLine = uActive
    ? t('premium.lineUserActive', locale, { date: stamp(uExp) })
    : t('premium.lineUserFree', locale);

  // Cartão de marca: dourado quando há Premium ativo (servidor ou user), blurple senão.
  const desc = [serverLine, youLine];
  // Só mostra o "como obter" quando NENHUM dos dois está ativo (senão é ruído).
  if (!gActive && !uActive) desc.push('', t('premium.getHint', locale));
  const embed = brandEmbed(gActive || uActive ? 'premium' : 'brand')
    .setTitle(t('premium.title', locale))
    .setDescription(desc.join('\n'));
  await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/** /redeem <code> — resgata um código de Premium (servidor) ou Plus (utilizador). */
export async function handleRedeem(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const code = i.options.getString('code', true).trim().toUpperCase();
  // SEC-02: um código de SERVIDOR é um artefacto pago — um membro qualquer não o
  // pode gastar (o redeem marca-o usado numa transação, irreversível). Espreita o
  // tipo SEM consumir e exige Gerir Servidor só para 'guild' (re-check server-side,
  // como no handleConfig). Códigos 'user' (Plus) continuam abertos a todos.
  if (peekRedeemCodeKind(deps.db, code) === 'guild') {
    const member = i.member as GuildMember;
    if (!member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
      await reply(i, t('redeem.needManageGuild', locale));
      return;
    }
  }
  const res = redeemCode(
    deps.db,
    code,
    { guildId: i.guildId ?? undefined, userId: i.user.id },
    Date.now(),
  );
  if (res.status === 'invalid') {
    await reply(i, t('redeem.invalid', locale));
    return;
  }
  if (res.status === 'used') {
    await reply(i, t('redeem.used', locale));
    return;
  }
  const target =
    res.kind === 'guild' ? t('redeem.targetServer', locale) : t('redeem.targetYou', locale);
  await reply(
    i,
    t('redeem.ok', locale, { target, date: `<t:${Math.floor(res.expiresAt! / 1000)}:D>` }),
  );
}

/** /uptime — PÚBLICO: há quanto tempo o Vozen está online. */
export async function handleUptime(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  await reply(i, t('uptime.text', locale, { uptime: formatDuration(process.uptime()) }));
}

/** /botstats — PÚBLICO: números de confiança (servidores, sessões de voz, uptime). */
export async function handleBotstats(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const snap = metrics.snapshot();
  const lines = [
    t('botstats.title', locale),
    t('botstats.servers', locale, { value: deps.client.guilds.cache.size }),
    t('botstats.voiceSessions', locale, { value: deps.players.size }),
    t('botstats.messagesSpoken', locale, { value: snap.messagesSpoken }),
    t('botstats.uptime', locale, { value: formatDuration(process.uptime()) }),
  ];
  await i.reply({
    embeds: [brandEmbed().setDescription(lines.join('\n'))],
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * /invite — devolve o URL de convite OAuth2 do bot, construido a partir do
 * CLIENT_ID da config. Gatilho do "loop viral".
 *
 * Decisoes de design:
 *  - Reply NORMAL (nao ephemeral): o objetivo do comando e partilhar o link, por
 *    isso queremos que fique visivel no canal para quem mais quiser adicionar o
 *    Vozen. Por isso NAO usamos o helper reply() (que e ephemeral) — chamamos
 *    i.reply() diretamente sem flags.
 *  - O URL e montado com URLSearchParams para escapar corretamente os valores; o
 *    scope "bot applications.commands" fica codificado (o espaco vira '+'), o que
 *    e valido para o endpoint OAuth2.
 *  - permissions = INVITE_PERMISSIONS (inteiro derivado dos 5 bits, ver topo).
 *  - Sem CLIENT_ID configurado: respondemos com uma mensagem clara em vez de
 *    gerar um link partido (client_id vazio). Verificamos com !clientId para
 *    apanhar tanto undefined como string vazia.
 */
export async function handleInvite(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const clientId = deps.config.clientId;
  if (!clientId) {
    await reply(i, t('invite.noClientId', locale));
    return;
  }
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'bot applications.commands',
    permissions: INVITE_PERMISSIONS,
  });
  const url = `https://discord.com/oauth2/authorize?${params.toString()}`;
  // Botão de link + o URL no texto (fica clicável e copiável). ButtonStyle.Link não tem
  // customId — leva só o URL, por isso não precisa de coletor.
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setURL(url)
      .setLabel(t('invite.button', locale))
      .setEmoji('➕'),
  );
  await i.reply({ content: t('invite.link', locale, { url }), components: [row] });
}

/**
 * /vote — devolve o link da pagina de voto do Vozen no top.gg (P11.5),
 * construido a partir do CLIENT_ID da config. Gatilho de crescimento, irmao do
 * /invite.
 *
 * Decisoes de design (espelham o /invite):
 *  - Reply NORMAL (nao ephemeral): o objetivo e PARTILHAR o link para que mais
 *    gente vote, por isso fica visivel no canal — NAO usamos o helper reply()
 *    (ephemeral); chamamos i.reply() diretamente sem flags.
 *  - URL = https://top.gg/bot/<CLIENT_ID>/vote. O CLIENT_ID e o id da aplicacao
 *    (o mesmo do /invite); o top.gg usa-o como id do bot na sua listagem.
 *  - Sem CLIENT_ID configurado: mensagem clara ephemeral em vez de um link
 *    partido (top.gg/bot//vote). Verificamos com !clientId (apanha undefined e
 *    string vazia), tal como o /invite.
 */
export async function handleVote(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const clientId = deps.config.clientId;
  if (!clientId) {
    await reply(i, t('vote.noClientId', locale));
    return;
  }
  const url = `https://top.gg/bot/${clientId}/vote`;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setURL(url)
      .setLabel(t('vote.button', locale))
      .setEmoji('🗳️'),
  );
  await i.reply({ content: t('vote.link', locale, { url }), components: [row] });
}

/**
 * /help — discovery de comandos em-app, pensado para PRINCIPIANTES (dono de
 * servidor ou membro que nunca usou o bot). Responde com um EMBED beginner-friendly:
 * intro do que o Vozen faz + um "Quick start (3 steps)" + comandos AGRUPADOS por
 * tarefa (Getting started / Your voice / Fun / Server admin / More), cada linha com
 * um one-liner amigavel e pelo menos um exemplo concreto.
 *
 * Decisoes de design:
 *  - TODO o texto e renderizado via t(key, locale) no locale da guild
 *    (getGuildConfig.locale). Por defeito (locale 'en') sai em INGLES; ha traducao
 *    'pt' para tudo. Os corpos dos grupos sao HAND-AUTHORED no catalogo (nao
 *    derivados das descricoes de commandDefs) porque "um exemplo concreto por
 *    seccao" nao se consegue derivar de uma descricao curta.
 *  - GUARD de cobertura: como os corpos sao hand-authored, corremos o risco de um
 *    comando NOVO em commandDefs ficar de fora. Para o /help continuar a ser a
 *    fonte de discovery, verificamos em runtime que TODOS os nomes top-level
 *    aparecem no texto montado; qualquer um que falte e APENSADO ao grupo "More".
 *    Assim o teste-guard (cada comando top-level aparece no /help) continua
 *    genuinamente protetor sem obrigar a listar tudo a mao.
 *  - Reply ephemeral para nao poluir o canal.
 */
export async function handleHelp(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  // Locale da INTERFACE do UTILIZADOR que pediu ajuda (o /help e ephemeral, so ele
  // o ve): usa o Discord locale do cliente dele (localeForUser), com fallback para o
  // locale da guild e depois DEFAULT_LOCALE. Nunca lanca.
  const locale = localeForUser(deps, i);

  // Cada FIELD tem um nome (cabecalho traduzido) e um value (corpo traduzido). O
  // quick-start vem primeiro para o principiante arrancar sem ler tudo.
  const fields: { name: string; value: string }[] = [
    { name: t('help.quickStartTitle', locale), value: t('help.quickStartBody', locale) },
    { name: t('help.groupStarted', locale), value: t('help.groupStartedBody', locale) },
    { name: t('help.groupVoice', locale), value: t('help.groupVoiceBody', locale) },
    { name: t('help.groupFun', locale), value: t('help.groupFunBody', locale) },
    { name: t('help.groupAdmin', locale), value: t('help.groupAdminBody', locale) },
    { name: t('help.groupMore', locale), value: t('help.groupMoreBody', locale) },
  ];

  // GUARD de cobertura: garante que nenhum comando top-level fica invisivel. Junta
  // todos os values numa string e, para cada commandDef, se `/nome` nao aparecer,
  // apensa-o ao grupo "More" (o ultimo field). Mantem o /help como discovery real
  // sem repetir a lista a mao.
  const mentioned = fields.map((f) => f.value).join('\n');
  const missing = commandDefs.map((d) => d.name).filter((name) => !mentioned.includes(`/${name}`));
  if (missing.length) {
    const more = fields[fields.length - 1];
    more.value += '\n' + missing.map((name) => `• /${name}`).join('\n');
  }

  // Linha de suporte/denúncia (requisito da Política de Desenvolvedor do Discord:
  // dar ao utilizador uma forma de reportar problemas). Vem do config (env
  // SUPPORT_URL; default = servidor de suporte oficial).
  const supportLine = t('help.support', locale, { url: deps.config.supportUrl });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2) // blurple — parece intencional, nao o cinzento default
    .setTitle(t('help.embedTitle', locale))
    // Descricao: tagline da marca + o que o Vozen faz (intro) + o diferenciador
    // (voz neural gratis) — a mesma chave do welcome embed — + a linha de suporte.
    .setDescription(
      `${t('help.title', locale)}\n${t('help.intro', locale)}\n\n${t('welcome.tagline', locale)}\n\n${supportLine}`,
    )
    .addFields(fields)
    .setFooter({ text: t('help.footer', locale, { command: '/setup' }) });

  await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
