// src/commands/handlers/core.ts — join/leave/tts/skip/shutup handlers + "Speak" context menu (extracted from index.ts, plan 015).
import {
  ChatInputCommandInteraction,
  MessageContextMenuCommandInteraction,
  GuildMember,
  Guild,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import type { BotDeps } from '../../bot/deps';
import { getPlayer, removePlayer, getLimiter } from '../../bot/deps';
import { createVoiceSession, becomeSpeakerIfStage } from '../../voice/session';
import { getUserVoice } from '../../store/userVoice';
import { resolveUserEngine } from '../../tts/resolveEngine';
import { getGuildConfig } from '../../store/guildConfig';
import { getBlocklist } from '../../store/blocklist';
import { getUserPronunciations, getServerPronunciations } from '../../store/pronunciation';
import { getVoiceEffect } from '../../store/voiceEffect';
import { getClone } from '../../store/voiceClone';
import { forgetVoicePresence } from '../../store/voicePresence';
import { cleanText, collectUrlMedia, collectMarkdownMedia } from '../../textCleaning/clean';
import { prepareSpeech, redactRequest, hasReadableText } from '../prepareSpeech';
import { log } from '../../logging/logger';
import { t } from '../../i18n/index';
import { localeFor, localeForUser, reply } from '../helpers';

/**
 * Result (discriminated) of trying to join Vozen to the caller's voice channel.
 * Does NOT contain UI text — the caller is what renders the message (via t()), so
 * that a single interaction produces a single response. This is what allows
 * sharing the logic between /join (which responds) and /setup (which folds the result
 * into its checklist), without risking a double-reply on the same interaction.
 */
export type JoinOutcome =
  | { status: 'no-channel' }
  | { status: 'missing-perms'; channelName: string }
  | { status: 'joined'; channelName: string };

/**
 * SHARED logic for "join the caller's voice channel", extracted from the old
 * handleJoin so it can be reused by /setup (guided onboarding). Effects:
 * checks Connect/Speak, (re)creates the player and the connection. Does NOT respond to the interaction
 * — returns a JoinOutcome that the caller translates. Contract preserved:
 *  - no voice channel            -> { status: 'no-channel' } (doesn't touch the player)
 *  - missing Connect/Speak       -> { status: 'missing-perms' } (doesn't destroy the existing player)
 *  - ok                          -> joins and returns { status: 'joined' }
 */
export function joinUserVoice(i: ChatInputCommandInteraction, deps: BotDeps): JoinOutcome {
  const member = i.member as GuildMember;
  const channel = member?.voice?.channel;
  if (!channel) {
    return { status: 'no-channel' };
  }
  // Check Connect/Speak permissions BEFORE touching the existing player: a
  // /join to a forbidden channel must not destroy a player that already works.
  const me = deps.client.user;
  const perms = me ? channel.permissionsFor(me) : null;
  if (!perms || !perms.has(PermissionFlagsBits.Connect) || !perms.has(PermissionFlagsBits.Speak)) {
    return { status: 'missing-perms', channelName: channel.name };
  }
  // Creates the session via the shared helper (same logic as autojoin). The
  // identity guard in onIdle lives there.
  createVoiceSession(deps, i.guildId!, channel.id, i.guild!.voiceAdapterCreator);
  becomeSpeakerIfStage(channel); // no-op if it's not a stage channel
  return { status: 'joined', channelName: channel.name };
}

export async function handleJoin(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const outcome = joinUserVoice(i, deps);
  switch (outcome.status) {
    case 'no-channel':
      await reply(i, t('join.needVoiceChannel', locale));
      return;
    case 'missing-perms':
      await reply(i, t('join.missingPerms', locale, { channel: outcome.channelName }));
      return;
    case 'joined':
      // PUBLIC announcement (everyone in the channel sees that Vozen joined, as a TTS
      // bot does) — NOT ephemeral. In the GUILD's language (localeFor), because it's a message
      // for everyone, not just the caller. The errors above stay ephemeral
      // (they're feedback for the caller). `i.reply` without flags = public message.
      await i.reply({
        content: t('join.joined', localeFor(deps, i.guildId), { channel: outcome.channelName }),
      });
      return;
  }
}

export async function handleLeave(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  removePlayer(deps, i.guildId!);
  // 24/7 in-call: EXPLICIT exit -> forgets the presence so it does NOT restore on startup
  // (unlike a restart/deploy, which preserves the purpose row).
  forgetVoicePresence(deps.db, i.guildId!);
  getVoiceConnection(i.guildId!)?.destroy();
  await reply(i, t('leave.left', localeForUser(deps, i)));
}

/** Result (discriminated) of trying to READ a text out loud with the user's voice. */
export type SpeakOutcome =
  | { status: 'no-player' }
  | { status: 'rate-limited' }
  | { status: 'empty' }
  | { status: 'blocked' }
  | { status: 'queued' }
  | { status: 'busy' };

/**
 * SHARED pipeline "read `raw` out loud with the user's voice", extracted from /tts to
 * be reused by the "Speak" context-menu. Does EVERYTHING (player gating, rate-limit,
 * cleaning, media, slang/pronunciation, voice choice, blocklist, say) EXCEPT respond to the
 * interaction — returns a SpeakOutcome that the caller translates. This way /tts and "Speak"
 * share the behavior without diverging. Also EXPORTED for /randomizer (speaks the
 * draw result with the voice of whoever ran it).
 */
export async function speakRawText(
  deps: BotDeps,
  guildId: string,
  userId: string,
  guild: Guild,
  raw: string,
): Promise<SpeakOutcome> {
  const player = getPlayer(deps, guildId);
  if (!player) return { status: 'no-player' };
  const cfg = getGuildConfig(deps.db, guildId);
  const rl = getLimiter(deps, guildId, cfg.ratePerMin);
  if (!rl.allow(userId, Date.now())) return { status: 'rate-limited' };

  const cleaned = cleanText(raw, {
    maxChars: cfg.maxChars,
    resolveUser: (id: string) =>
      guild.members.cache.get(id)?.displayName ??
      deps.client.users.cache.get(id)?.username ??
      'someone',
    resolveChannel: (id: string) => {
      const ch = guild.channels.cache.get(id);
      return ch && 'name' in ch ? (ch.name as string) : 'channel';
    },
  });
  const media = [...collectUrlMedia(raw), ...collectMarkdownMedia(raw)];
  if (!/[\p{L}\p{N}]/u.test(cleaned) && media.length === 0) return { status: 'empty' };

  const userVoice = getUserVoice(deps.db, guildId, userId);
  const { req } = prepareSpeech({
    personal: cleaned,
    // Pronunciations of the caller (/tts and Speak read with the caller's voice + rules),
    // followed by the SERVER's (apply to everyone).
    pronunciations: [
      ...getUserPronunciations(deps.db, userId),
      ...getServerPronunciations(deps.db, guildId),
    ],
    userVoice,
    available: deps.availableModels,
    guildDefaultVoice: cfg.defaultVoice,
    defaultVoice: deps.config.defaultVoice,
    defaultSpeed: deps.config.defaultSpeed,
    media: media.map((kind) => ({ kind })),
  });
  // Engine chosen by the user — resolved by the shared gate (gcloud->google without
  // Premium; Phase 3 attaches the budget). The two fields the resolver returns are
  // exactly engine + gcloudBudget of the SynthRequest.
  const resolvedEngine = resolveUserEngine(deps.db, guildId, userId, userVoice?.engine, Date.now());
  req.engine = resolvedEngine.engine;
  req.gcloudBudget = resolvedEngine.gcloudBudget;

  // Blocklist: REDACTS the blocked words (Vozen reads the rest without saying them). Only returns
  // 'blocked' if, after removing them, nothing readable is left (it was only a blocked word).
  const blocklist = getBlocklist(deps.db, guildId);
  const redacted = redactRequest(req, blocklist);
  const readable =
    hasReadableText(redacted.text) ||
    (redacted.segments?.some((s) => hasReadableText(s.text)) ?? false);
  if (!readable) return { status: 'blocked' };
  const outReq = redacted;
  outReq.effect = getVoiceEffect(deps.db, guildId, userId); // voice effect (premium)
  const cloneRow = getClone(deps.db, userId); // voice clone (premium)
  if (cloneRow?.enabled) outReq.cloneRef = cloneRow.samplePath;
  if (deps.config.messageLeadMs > 0) outReq.leadSilenceMs = deps.config.messageLeadMs;
  const queued = await player.say(outReq);
  return { status: queued ? 'queued' : 'busy' };
}

/** Translates a SpeakOutcome into the (ephemeral) message to show the user. */
function speakOutcomeMessage(outcome: SpeakOutcome, locale: string): string {
  switch (outcome.status) {
    case 'no-player':
      return t('tts.notInVoice', locale);
    case 'rate-limited':
      return t('tts.tooFast', locale);
    case 'empty':
      return t('tts.nothingAfterClean', locale);
    case 'blocked':
      return t('tts.blocked', locale);
    case 'busy':
      return t('tts.busy', locale);
    case 'queued':
      return t('tts.queued', locale);
  }
}

export async function handleTts(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  // Synthesis can take up to ~15s; defer immediately so we don't lose the token (3s).
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const locale = localeForUser(deps, i);
  const raw = i.options.getString('text', true).trim();
  if (!raw) {
    await i.editReply(t('tts.nothingToRead', locale));
    return;
  }
  const outcome = await speakRawText(deps, i.guildId!, i.user.id, i.guild!, raw);
  await i.editReply(speakOutcomeMessage(outcome, locale));
}

/**
 * "Speak" context-menu (right-click a message -> Apps -> Speak): reads that message
 * out loud with the voice of whoever clicked. Same pipeline as /tts (speakRawText), but the
 * text comes from the target message instead of an argument.
 */
export async function handleMessageContextMenu(
  i: MessageContextMenuCommandInteraction,
  deps: BotDeps,
): Promise<void> {
  if (i.commandName !== 'Speak') return;
  const locale = localeForUser(deps, i);
  // Unlike the slash commands (all protected by handleInteraction's try/catch),
  // the context-menu is dispatched directly in client.ts with
  // `void handleMessageContextMenu(...)` — WITHOUT catch. Without this try/catch, a throw
  // in speakRawText would leave the user stuck at "Vozen is thinking…" forever
  // (the deferReply was never edited) + unhandledRejection. Mirrors the slash catch.
  try {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    if (!i.guildId || !i.guild) {
      await i.editReply(t('error.generic', locale));
      return;
    }
    const raw = (i.targetMessage.content ?? '').trim();
    if (!raw) {
      await i.editReply(t('speak.emptyMessage', locale));
      return;
    }
    const outcome = await speakRawText(deps, i.guildId, i.user.id, i.guild, raw);
    await i.editReply(speakOutcomeMessage(outcome, locale));
  } catch (err) {
    log.error('[speak] Speak context-menu error:', err);
    if (!i.isRepliable()) return;
    const msg = t('error.generic', locale);
    if (i.deferred && !i.replied) {
      await i.editReply({ content: msg }).catch(() => {});
    } else if (!i.replied) {
      await i.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

export async function handleSkip(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const player = getPlayer(deps, i.guildId!);
  if (!player) {
    await reply(i, t('skip.notInVoice', locale));
    return;
  }
  // There is a player, but it may be stopped (nothing playing nor in the queue). Read isActive()
  // BEFORE skip() — skip() would do stop()/emit(Idle) and distort the state — so as
  // not to pretend it skipped something when there was nothing. skip.notInVoice covers
  // "no player at all"; skip.nothing covers "there is a player but it's stopped".
  if (!player.isActive()) {
    await reply(i, t('skip.nothing', locale));
    return;
  }
  player.skip();
  await reply(i, t('skip.skipped', locale));
}

/** /shutup — silences Vozen now: clears the queue and stops what's playing (stays in the call). */
export async function handleShutup(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const player = getPlayer(deps, i.guildId!);
  if (!player) {
    await reply(i, t('shutup.notInVoice', locale));
    return;
  }
  // Read isActive() BEFORE silence() (silence does stop()/emit(Idle) and would distort the
  // state): distinguishes "there was nothing to say" from "actually silenced it".
  if (!player.isActive()) {
    await reply(i, t('shutup.nothing', locale));
    return;
  }
  player.silence();
  await reply(i, t('shutup.done', locale));
}
