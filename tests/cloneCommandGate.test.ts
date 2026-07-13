import { describe, it, expect } from 'vitest';
import { withoutCloneGroup, commandDefs } from '../src/commands/definitions';

// Gate de visibilidade do grupo /voice clone. No bot alojado (sem GPU/RAM para o
// Chatterbox — ver docs/SPIKE-CLONE.md) o grupo não deve aparecer no picker; quem já
// gravou uma amostra continua a poder apagá-la via /privacy erase. Só CLONE_ENABLED=1
// (máquina com motor) o mostra. commandDefs default (env off nos testes) = sem clone.

function voiceOptions(defs: typeof commandDefs) {
  const voice = defs.find((d) => d.name === 'voice') as { options?: { name: string }[] };
  return (voice?.options ?? []).map((o) => o.name);
}

describe('withoutCloneGroup', () => {
  it('remove o grupo clone do /voice, preservando os outros subcomandos', () => {
    const input = [
      { name: 'voice', options: [{ name: 'set' }, { name: 'clone' }, { name: 'effect' }] },
      { name: 'config', options: [{ name: 'clone' }] }, // não é /voice -> intocado
    ] as unknown as typeof commandDefs;
    const out = withoutCloneGroup(input);
    expect((out[0] as { options: { name: string }[] }).options.map((o) => o.name)).toEqual([
      'set',
      'effect',
    ]);
    // outros comandos ficam iguais (mesmo que tenham uma opção chamada 'clone')
    expect(out[1]).toEqual(input[1]);
  });

  it('é no-op quando /voice não tem grupo clone', () => {
    const input = [{ name: 'voice', options: [{ name: 'set' }] }] as unknown as typeof commandDefs;
    expect(withoutCloneGroup(input)).toEqual(input);
  });

  it('tolera comandos sem options', () => {
    const input = [{ name: 'voice' }, { name: 'ping' }] as unknown as typeof commandDefs;
    expect(withoutCloneGroup(input)).toEqual(input);
  });
});

describe('commandDefs (gate por CLONE_ENABLED)', () => {
  it('sem CLONE_ENABLED (default) o /voice NÃO tem o grupo clone', () => {
    // Os testes correm sem CLONE_ENABLED=1 -> o grupo está escondido.
    expect(voiceOptions(commandDefs)).not.toContain('clone');
  });

  it('o /voice continua a existir com os outros subcomandos', () => {
    expect(voiceOptions(commandDefs).length).toBeGreaterThan(0);
    expect(voiceOptions(commandDefs)).toContain('set');
  });
});
