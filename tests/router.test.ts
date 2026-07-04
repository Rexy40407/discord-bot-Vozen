import { describe, it, expect, vi } from 'vitest';
import { RouterEngine, type EngineRoute } from '../src/tts/router';
import type { SynthRequest, TTSEngine } from '../src/tts/engine';

// Motor falso: devolve um caminho identificável, ou lança se `fail`.
function fakeEngine(name: string, fail = false): TTSEngine {
  return {
    synth: vi.fn(async (_req: SynthRequest) => {
      if (fail) throw new Error(`${name} falhou`);
      return `/wav/${name}.wav`;
    }),
  };
}

const req = (model: string): SynthRequest => ({ text: 'olá', model, speed: 1 });

describe('RouterEngine — construção', () => {
  it('exige pelo menos um motor', () => {
    expect(() => new RouterEngine([])).toThrow(/pelo menos um motor/);
  });

  it('exige que o último motor seja apanha-tudo (langs=null)', () => {
    const routes: EngineRoute[] = [
      { engine: fakeEngine('kokoro'), langs: new Set(['pt']), label: 'kokoro' },
    ];
    expect(() => new RouterEngine(routes)).toThrow(/apanha-tudo/);
  });
});

describe('RouterEngine — roteamento por língua', () => {
  it('usa o motor específico da língua quando existe', async () => {
    const kokoro = fakeEngine('kokoro');
    const piper = fakeEngine('piper');
    const r = new RouterEngine([
      { engine: kokoro, langs: new Set(['pt', 'en']), label: 'kokoro' },
      { engine: piper, langs: null, label: 'piper' },
    ]);
    expect(await r.synth(req('pt_BR-cadu-medium'))).toBe('/wav/kokoro.wav');
    expect(kokoro.synth).toHaveBeenCalledTimes(1);
    expect(piper.synth).not.toHaveBeenCalled();
  });

  it('cai no apanha-tudo quando a língua não é suportada em cima', async () => {
    const kokoro = fakeEngine('kokoro');
    const piper = fakeEngine('piper');
    const r = new RouterEngine([
      { engine: kokoro, langs: new Set(['pt', 'en']), label: 'kokoro' },
      { engine: piper, langs: null, label: 'piper' },
    ]);
    // 'de' (alemão) não está no Kokoro -> vai direto ao Piper.
    expect(await r.synth(req('de_DE-thorsten-medium'))).toBe('/wav/piper.wav');
    expect(kokoro.synth).not.toHaveBeenCalled();
    expect(piper.synth).toHaveBeenCalledTimes(1);
  });
});

describe('RouterEngine — fallback por FALHA', () => {
  it('gTTS falha -> serve o Piper (mesma língua)', async () => {
    const gtts = fakeEngine('gtts', true); // falha (ex.: HTTP 429 da Google)
    const piper = fakeEngine('piper');
    const r = new RouterEngine([
      { engine: gtts, langs: null, label: 'gtts' },
      { engine: piper, langs: null, label: 'piper' },
    ]);
    expect(await r.synth(req('pt_BR-cadu-medium'))).toBe('/wav/piper.wav');
    expect(gtts.synth).toHaveBeenCalledTimes(1);
    expect(piper.synth).toHaveBeenCalledTimes(1);
  });

  it('atravessa vários motores em falha até um funcionar', async () => {
    const kokoro = fakeEngine('kokoro', true);
    const gtts = fakeEngine('gtts', true);
    const piper = fakeEngine('piper');
    const r = new RouterEngine([
      { engine: kokoro, langs: new Set(['pt']), label: 'kokoro' },
      { engine: gtts, langs: null, label: 'gtts' },
      { engine: piper, langs: null, label: 'piper' },
    ]);
    expect(await r.synth(req('pt_BR-cadu-medium'))).toBe('/wav/piper.wav');
  });

  it('todos falham -> propaga o último erro', async () => {
    const gtts = fakeEngine('gtts', true);
    const piper = fakeEngine('piper', true);
    const r = new RouterEngine([
      { engine: gtts, langs: null, label: 'gtts' },
      { engine: piper, langs: null, label: 'piper' },
    ]);
    await expect(r.synth(req('pt_BR-cadu-medium'))).rejects.toThrow(/piper falhou/);
  });
});
