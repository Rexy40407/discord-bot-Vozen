// src/voice/session.ts
//
// Creates a voice session (connection + player) for a guild/channel. It is the SINGLE
// SOURCE of this logic, shared by /join (joinUserVoice, from an interaction) and by
// autojoin (from a message) — so they don't diverge (e.g. the identity guard in onIdle,
// which avoids tearing down a replacement player).

import {
  joinVoiceChannel,
  getVoiceConnection,
  type DiscordGatewayAdapterCreator,
} from '@discordjs/voice';
import { ChannelType, type VoiceBasedChannel } from 'discord.js';
import { GuildVoicePlayer } from './player';
import type { BotDeps } from '../bot/deps';
import { removePlayer } from '../bot/deps';
import { isGuildPremium } from '../store/premium';
import { getGuildConfig } from '../store/guildConfig';
import { rememberVoicePresence } from '../store/voicePresence';
import { log } from '../logging/logger';

/**
 * STAGE channels: when joining a stage channel, the bot ends up as AUDIENCE (suppressed)
 * and is not heard. Here we request to be a SPEAKER (setSuppressed(false)); if there's no
 * permission for that, we request to speak (setRequestToSpeak). Best-effort and
 * fire-and-forget — NEVER blocks or crashes the join; in a normal voice channel it's a
 * no-op. NOT unit-testable (needs a real Discord stage).
 */
export function becomeSpeakerIfStage(channel: VoiceBasedChannel): void {
  if (channel.type !== ChannelType.GuildStageVoice) return;
  const voice = channel.guild?.members?.me?.voice;
  if (!voice) return;
  Promise.resolve(voice.setSuppressed(false)).catch(() => {
    // No permission to self-promote -> request to speak (the moderator accepts).
    Promise.resolve(voice.setRequestToSpeak(true)).catch((err) => {
      log.warn('[voice] failed to become a stage speaker (ignored)', err);
    });
  });
}

/**
 * (Re)creates the guild's voice session in the given channel and returns the player.
 * Replaces any previous player (removePlayer first). The onIdle is identity-aware: it
 * only tears down the session if THIS player is still the registered one (a /join during
 * a reconnection may have installed another in the same slot). Does NOT check permissions
 * — it's the caller that validates Connect/Speak beforehand.
 */
export function createVoiceSession(
  deps: BotDeps,
  guildId: string,
  channelId: string,
  adapterCreator: DiscordGatewayAdapterCreator,
): GuildVoicePlayer {
  removePlayer(deps, guildId);
  const connection = joinVoiceChannel({
    channelId,
    guildId,
    adapterCreator,
    selfDeaf: true,
    selfMute: false,
  });
  const player = new GuildVoicePlayer(connection, deps.engine, deps.config.queueCap, () => {
    if (deps.players.get(guildId) !== player) return;
    removePlayer(deps, guildId);
    getVoiceConnection(guildId)?.destroy();
  });
  deps.players.set(guildId, player);
  // 24/7 in-call: only persists the channel when the guild is Premium AND turned on the
  // toggle (/config always-on, default OFF) — so it is restored on startup (see rejoin.ts).
  // Best-effort — NEVER blocks joining the call (and a deps without a db, as in tests,
  // falls into the catch with no effect).
  try {
    if (
      isGuildPremium(deps.db, guildId, Date.now()) &&
      getGuildConfig(deps.db, guildId).stayInCall
    ) {
      rememberVoicePresence(deps.db, guildId, channelId, Date.now());
    }
  } catch (err) {
    log.warn('[voice] failed to persist 24/7 presence (ignored)', err);
  }
  return player;
}
