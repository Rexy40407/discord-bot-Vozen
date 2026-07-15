import { describe, it, expect } from 'vitest';
import { withoutCloneGroup, commandDefs } from '../src/commands/definitions';

// Visibility gate for the /voice clone group. On the hosted bot (no GPU/RAM for
// Chatterbox — see docs/SPIKE-CLONE.md) the group must not appear in the picker; anyone
// who already recorded a sample can still delete it via /privacy erase. Only CLONE_ENABLED=1
// (a machine with the engine) shows it. commandDefs default (env off in tests) = no clone.

function voiceOptions(defs: typeof commandDefs) {
  const voice = defs.find((d) => d.name === 'voice') as { options?: { name: string }[] };
  return (voice?.options ?? []).map((o) => o.name);
}

describe('withoutCloneGroup', () => {
  it('removes the clone group from /voice, preserving the other subcommands', () => {
    const input = [
      { name: 'voice', options: [{ name: 'set' }, { name: 'clone' }, { name: 'effect' }] },
      { name: 'config', options: [{ name: 'clone' }] }, // not /voice -> untouched
    ] as unknown as typeof commandDefs;
    const out = withoutCloneGroup(input);
    expect((out[0] as { options: { name: string }[] }).options.map((o) => o.name)).toEqual([
      'set',
      'effect',
    ]);
    // other commands stay the same (even if they have an option named 'clone')
    expect(out[1]).toEqual(input[1]);
  });

  it('is a no-op when /voice has no clone group', () => {
    const input = [{ name: 'voice', options: [{ name: 'set' }] }] as unknown as typeof commandDefs;
    expect(withoutCloneGroup(input)).toEqual(input);
  });

  it('tolerates commands without options', () => {
    const input = [{ name: 'voice' }, { name: 'ping' }] as unknown as typeof commandDefs;
    expect(withoutCloneGroup(input)).toEqual(input);
  });
});

describe('commandDefs (gated by CLONE_ENABLED)', () => {
  it('without CLONE_ENABLED (default) /voice does NOT have the clone group', () => {
    // Tests run without CLONE_ENABLED=1 -> the group is hidden.
    expect(voiceOptions(commandDefs)).not.toContain('clone');
  });

  it('/voice still exists with the other subcommands', () => {
    expect(voiceOptions(commandDefs).length).toBeGreaterThan(0);
    expect(voiceOptions(commandDefs)).toContain('set');
  });
});
