import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isQuestion, splitTailWav, ProsodyEngine, QUESTION_FILTER } from '../src/tts/prosody';
import { silenceWav, parseWav, buildWav } from '../src/tts/wavConcat';
import { AudioCache } from '../src/tts/cache';
import type { SynthRequest, TTSEngine } from '../src/tts/engine';

describe('isQuestion — a fala acaba em "?"', () => {
  it('true quando acaba em "?" (tolera aspas/parênteses/espaços)', () => {
    expect(isQuestion('tudo bem?')).toBe(true);
    expect(isQuestion('a sério?  ')).toBe(true);
    expect(isQuestion('(estás aí?)')).toBe(true);
    expect(isQuestion('ele disse "queres?"')).toBe(true);
  });

  it('false quando não é pergunta ou o "?" está a meio', () => {
    expect(isQuestion('olá tudo bem')).toBe(false);
    expect(isQuestion('a sério? claro que sim')).toBe(false); // "?" a meio
    expect(isQuestion('cuidado!')).toBe(false);
    expect(isQuestion('WHAT?!')).toBe(false); // acaba em "!" -> é grito, não pergunta
    expect(isQuestion('')).toBe(false);
  });
});

describe('QUESTION_FILTER — usa só filtros CORE do ffmpeg', () => {
  it('é asetrate+aresample+atempo (mesma mecânica do deep/chipmunk)', () => {
    expect(QUESTION_FILTER).toContain('asetrate=22050');
    expect(QUESTION_FILTER).toContain('aresample=22050');
    expect(QUESTION_FILTER).toContain('atempo=');
  });
});

describe('splitTailWav — corta os últimos ms como WAV', () => {
  it('parte um WAV válido em [corpo, rabo] com a soma das durações intacta', () => {
    const wav = silenceWav(1000); // 22050 samples * 2 bytes = 44100 bytes de dados
    const split = splitTailWav(wav, 500);
    expect(split).not.toBeNull();
    const headLen = parseWav(split!.head, 0).data.length;
    const tailLen = parseWav(split!.tail, 0).data.length;
    expect(tailLen).toBe(11025 * 2); // 500 ms @ 22050 Hz, 16-bit mono
    expect(headLen + tailLen).toBe(44100); // nada se perde
  });

  it('fala curta -> corpo vazio, rabo = tudo', () => {
    const wav = silenceWav(200); // 4410 samples
    const split = splitTailWav(wav, 500);
    expect(split).not.toBeNull();
    expect(parseWav(split!.head, 0).data.length).toBe(0);
    expect(parseWav(split!.tail, 0).data.length).toBe(4410 * 2);
  });

  it('formato inesperado (sample rate ≠ 22050) -> null (fail-safe)', () => {
    const wav = Buffer.from(silenceWav(300)); // cópia mutável
    wav.writeUInt32LE(24000, 24); // patch do sample rate no header canónico
    expect(splitTailWav(wav, 500)).toBeNull();
  });

  it('não-WAV -> null', () => {
    expect(splitTailWav(Buffer.from('isto não é um wav'), 500)).toBeNull();
  });
});

// Fake do spawn do ffmpeg: 'ok' escreve um WAV VÁLIDO no out e sai 0; 'fail' sai 1.
function fakeFfmpeg(behavior: 'ok' | 'fail') {
  return ((_ff: string, args: readonly string[]) => {
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: () => void };
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      if (behavior === 'ok') {
        const outPath = args[args.length - 2]; // [..., outPath, '-y']
        writeFileSync(outPath, silenceWav(200)); // WAV canónico 22050/mono/16
        child.emit('close', 0);
      } else {
        child.stderr.emit('data', Buffer.from('bad filter'));
        child.emit('close', 1);
      }
    });
    return child;
  }) as unknown as typeof import('node:child_process').spawn;
}

const REQ_Q: SynthRequest = { text: 'tudo bem?', model: 'en_US-amy-medium', speed: 1 };
const innerReturning = (p: string): TTSEngine => ({ synth: async () => p });

describe('ProsodyEngine — entoação de pergunta', () => {
  const dirs: string[] = [];
  const cache = () => {
    const d = mkdtempSync(join(tmpdir(), 'q-cache-'));
    dirs.push(d);
    return new AudioCache(d);
  };
  const baseWav = () => {
    const d = mkdtempSync(join(tmpdir(), 'q-base-'));
    dirs.push(d);
    const p = join(d, 'base.wav');
    writeFileSync(p, silenceWav(1000));
    return p;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('fala SEM "?" -> devolve o WAV base tal e qual (não chama ffmpeg)', async () => {
    const eng = new ProsodyEngine(innerReturning('/base.wav'), cache(), {
      spawnImpl: fakeFfmpeg('fail'), // falharia se fosse chamado
    });
    expect(await eng.synth({ ...REQ_Q, text: 'olá tudo bem' })).toBe('/base.wav');
  });

  it('pergunta -> WAV novo na cache "q" (válido) e cache-hit no 2.º', async () => {
    const base = baseWav();
    const eng = new ProsodyEngine(innerReturning(base), cache(), {
      ffmpegPath: '/fake/ffmpeg',
      spawnImpl: fakeFfmpeg('ok'),
    });
    const out1 = await eng.synth({ ...REQ_Q });
    expect(out1).not.toBe(base);
    expect(existsSync(out1)).toBe(true);
    expect(() => parseWav(readFileSync(out1), 0)).not.toThrow(); // é um WAV válido
    const out2 = await eng.synth({ ...REQ_Q });
    expect(out2).toBe(out1); // cache-hit
  });

  it('CRÍTICO: falha do ffmpeg -> cai na VOZ LIMPA (nunca lança)', async () => {
    const base = baseWav();
    const eng = new ProsodyEngine(innerReturning(base), cache(), {
      ffmpegPath: '/fake/ffmpeg',
      spawnImpl: fakeFfmpeg('fail'),
    });
    await expect(eng.synth({ ...REQ_Q })).resolves.toBe(base);
  });

  it('formato base inesperado (não 22050) -> voz limpa, sem chamar ffmpeg', async () => {
    const d = mkdtempSync(join(tmpdir(), 'q-odd-'));
    dirs.push(d);
    const odd = join(d, 'odd.wav');
    const wav = Buffer.from(silenceWav(1000));
    wav.writeUInt32LE(24000, 24); // sample rate errado
    writeFileSync(odd, wav);
    const eng = new ProsodyEngine(innerReturning(odd), cache(), {
      ffmpegPath: '/fake/ffmpeg',
      spawnImpl: fakeFfmpeg('fail'), // falharia se chegasse ao ffmpeg
    });
    await expect(eng.synth({ ...REQ_Q })).resolves.toBe(odd);
  });

  it('buildWav round-trip: o header canónico volta a parsear', () => {
    const wav = buildWav(Buffer.alloc(100));
    expect(parseWav(wav, 0).data.length).toBe(100);
  });
});
