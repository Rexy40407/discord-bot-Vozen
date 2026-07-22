import type { GuildConfig } from '../store/guildConfig';
import type { ChannelProfile } from '../store/channelProfiles';

/**
 * The only interpretation of profile fields. Callers still enforce permissions, opt-out,
 * blocked roles, queue capacity, and same-call separately; a profile never grants an exception.
 */
export interface EffectiveChannelPolicy {
  autoRead: boolean;
  translationEnabled: boolean;
  defaultVoice: string;
}

export function resolveChannelPolicy(
  guild: Pick<GuildConfig, 'autoread' | 'translationEnabled' | 'defaultVoice'>,
  profile: ChannelProfile | null | undefined,
): EffectiveChannelPolicy {
  return {
    autoRead: profile?.autoRead ?? guild.autoread,
    translationEnabled: profile?.translationEnabled ?? guild.translationEnabled,
    defaultVoice: profile?.defaultVoice ?? guild.defaultVoice,
  };
}
