// src/commands/handlers/privacy.ts
//
// /privacy erase — direito ao esquecimento (RGPD / Política do Discord §5(b)): apaga
// TODOS os dados pessoais do utilizador em qualquer servidor, num só comando. Confirmação
// obrigatória por botão (é destrutivo). O premium PAGO e o registo financeiro NÃO são
// apagados (retenção legal + é um bem que a pessoa comprou) — avisa-se isso antes.
import {
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} from 'discord.js';
import { unlink } from 'node:fs/promises';
import type { BotDeps } from '../../bot/deps';
import { eraseUser } from '../../store/dataLifecycle';
import { isUserPremium, isGuildPremium } from '../../store/premium';
import { t } from '../../i18n/index';
import { localeForUser } from '../helpers';
import { log } from '../../logging/logger';

export async function handlePrivacy(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  if (i.options.getSubcommand() === 'erase') {
    await handleErase(i, deps);
  }
}

async function handleErase(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const now = Date.now();
  const hasPaid =
    isUserPremium(deps.db, i.user.id, now) ||
    (i.guildId ? isGuildPremium(deps.db, i.guildId, now) : false);

  // Aviso + botões (efémero: só o próprio vê/clica).
  const warning = hasPaid
    ? `${t('privacy.eraseConfirm', locale)}\n\n${t('privacy.erasePremiumNote', locale)}`
    : t('privacy.eraseConfirm', locale);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('privEraseYes')
      .setLabel(t('privacy.eraseYes', locale))
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️'),
    new ButtonBuilder()
      .setCustomId('privEraseNo')
      .setLabel(t('privacy.eraseNo', locale))
      .setStyle(ButtonStyle.Secondary),
  );
  const response = await i.reply({
    content: warning,
    components: [row],
    flags: MessageFlags.Ephemeral,
  });

  const btn = await response
    .awaitMessageComponent({ componentType: ComponentType.Button, time: 30_000 })
    .catch(() => null);
  if (!btn || btn.customId !== 'privEraseYes') {
    await i
      .editReply({ content: t('privacy.eraseCancelled', locale), components: [] })
      .catch(() => {});
    return;
  }

  let removedSamplePaths: string[];
  try {
    ({ removedSamplePaths } = eraseUser(deps.db, i.user.id));
  } catch (err) {
    log.error('[privacy] failed to erase user data', err);
    await btn.update({ content: t('error.generic', locale), components: [] }).catch(() => {});
    return;
  }
  // Apaga os .wav de clone do disco (best-effort — a linha na BD já desapareceu).
  for (const p of removedSamplePaths) {
    await unlink(p).catch(() => {});
  }
  await btn.update({ content: t('privacy.eraseDone', locale), components: [] }).catch(() => {});
}
