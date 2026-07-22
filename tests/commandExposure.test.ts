import { describe, expect, it } from 'vitest';
import { commandDefs, commandExposure } from '../src/commands/definitions';

describe('command exposure policy', () => {
  it('defaults every unreviewed command to guild-only and never User App eligible', () => {
    expect(commandExposure('future-command')).toMatchObject({
      dmSafe: false,
      userAppCandidate: false,
    });
  });

  it('keeps voice, administration, configuration and translation commands out of DMs/User Apps', () => {
    for (const name of [
      'join',
      'leave',
      'tts',
      'tts-file',
      'Speak',
      'voice',
      'config',
      'setup',
      'translate',
      'transcribe',
      'queue',
      'premium',
    ]) {
      expect(commandExposure(name)).toMatchObject({ dmSafe: false, userAppCandidate: false });
    }
  });

  it('has exactly the reviewed DM-safe command set and restricts all other registered commands', () => {
    const dmSafe = commandDefs
      .filter((def) => commandExposure(def.name).dmSafe)
      .map((def) => def.name);
    expect(dmSafe).toEqual(['invite', 'vote', 'help', 'uptime', 'bot-stats', 'redeem']);
    for (const def of commandDefs) {
      if (!commandExposure(def.name).dmSafe) {
        expect((def as { contexts?: number[] }).contexts).toEqual([0]);
      }
    }
  });
});
