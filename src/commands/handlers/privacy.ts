// src/commands/handlers/privacy.ts
//
// /privacy erase — right to be forgotten (GDPR / Discord Policy §5(b)): erases ALL of
// the user's personal data in any server, in a single command. Button confirmation
// required (it's destructive). PAID premium and the financial record are NOT erased
// (legal retention + it's an asset the person bought) — this is warned about beforehand.
import {
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { BotDeps } from '../../bot/deps';
import { eraseUser } from '../../store/dataLifecycle';
import { purgeCloneDerivedAudio } from '../../tts/cache';
import { isUserPremium, isGuildPremium } from '../../store/premium';
import { t } from '../../i18n/index';
import { localeForUser } from '../helpers';
import { log } from '../../logging/logger';
import { editCard, replyCard, updateCard } from '../../ui/messages';

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

  // Warning + buttons (ephemeral: only the user sees/clicks).
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
  const response = await i.reply(
    replyCard(warning, { ephemeral: true, tone: 'danger', rows: [row] }),
  );

  const btn = await response
    .awaitMessageComponent({ componentType: ComponentType.Button, time: 30_000 })
    .catch(() => null);
  if (!btn || btn.customId !== 'privEraseYes') {
    await i
      .editReply(editCard(t('privacy.eraseCancelled', locale), { tone: 'warning' }))
      .catch(() => {});
    return;
  }

  let removedSamplePaths: string[];
  try {
    ({ removedSamplePaths } = eraseUser(deps.db, i.user.id));
  } catch (err) {
    log.error('[privacy] failed to erase user data', err);
    await btn.update(updateCard(t('error.generic', locale), { tone: 'danger' })).catch(() => {});
    return;
  }
  // Delete the clone .wav files from disk (best-effort — the DB row is already gone).
  for (const p of removedSamplePaths) {
    await unlink(p).catch(() => {});
  }
  // If the person had a cloned voice, also purge the generated cloned AUDIO (audio-cache/
  // clone/ and /fx/) — otherwise it would survive the biometric erasure until evicted by LRU.
  // The keys are hashes, so the entire namespace is cleared (regenerable).
  if (removedSamplePaths.length > 0) {
    purgeCloneDerivedAudio(join(dirname(deps.config.dbPath), 'audio-cache'));
  }
  await btn.update(updateCard(t('privacy.eraseDone', locale), { tone: 'success' })).catch(() => {});
}
