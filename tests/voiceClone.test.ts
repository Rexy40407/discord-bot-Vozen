import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { getClone, saveClone, setCloneEnabled, deleteClone } from '../src/store/voiceClone';
import { VoicedCollector, pcmToWavFile } from '../src/voice/recorder';

// PCM s16le 48kHz estéreo: 192 bytes/ms.
const BYTES_PER_MS = 192;

/** Buffer "com voz": amostras int16 constantes bem acima do chão de ruído. */
function voiced(ms: number, amplitude = 3000): Buffer {
  const buf = Buffer.alloc(ms * BYTES_PER_MS);
  for (let i = 0; i < buf.length; i += 2) buf.writeInt16LE(amplitude, i);
  return buf;
}
/** Buffer de silêncio (zeros — RMS 0). */
function silence(ms: number): Buffer {
  return Buffer.alloc(ms * BYTES_PER_MS);
}

describe('VoicedCollector — só conta frames com voz', () => {
  it('silêncio não conta; voz conta; done ao atingir o alvo', () => {
    const c = new VoicedCollector(20); // alvo: 20ms de FALA
    expect(c.push(silence(50))).toBe(false); // 50ms de silêncio -> 0 contados
    expect(c.voicedMs).toBe(0);
    expect(c.push(voiced(10))).toBe(false); // 10/20
    expect(c.voicedMs).toBe(10);
    expect(c.push(voiced(10))).toBe(true); // 20/20 -> done
    expect(c.done).toBe(true);
    expect(c.voicedMs).toBe(20);
  });

  it('pcm() devolve só os frames com voz, pela ordem', () => {
    const c = new VoicedCollector(1000);
    c.push(voiced(5));
    c.push(silence(5));
    c.push(voiced(5));
    expect(c.pcm().length).toBe(10 * BYTES_PER_MS); // 10ms de voz, sem o silêncio
  });

  it('buffer vazio é ignorado sem rebentar', () => {
    const c = new VoicedCollector(10);
    expect(c.push(Buffer.alloc(0))).toBe(false);
    expect(c.voicedMs).toBe(0);
  });
});

// Fake do ffmpeg (mesmo padrão do effects.test): 'ok' escreve o WAV e sai 0.
function fakeFfmpeg(behavior: 'ok' | 'fail') {
  return ((_ff: string, args: readonly string[]) => {
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: () => void };
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      if (behavior === 'ok') {
        const outPath = args[args.length - 2]; // [..., wavPath, '-y']
        writeFileSync(outPath, Buffer.from('RIFFfake'));
        child.emit('close', 0);
      } else {
        child.stderr.emit('data', Buffer.from('boom'));
        child.emit('close', 1);
      }
    });
    return child;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

describe('pcmToWavFile — conversão + escrita no destino', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clone-wav-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('sucesso: cria o diretório de destino e escreve o WAV', async () => {
    const out = join(dir, 'clones', 'user-1.wav');
    const res = await pcmToWavFile(voiced(10), out, {
      ffmpegPath: '/fake/ffmpeg',
      spawnImpl: fakeFfmpeg('ok'),
    });
    expect(res).toBe(out);
    expect(existsSync(out)).toBe(true);
  });

  it('falha do ffmpeg -> rejeita', async () => {
    await expect(
      pcmToWavFile(voiced(10), join(dir, 'x.wav'), { ffmpegPath: '/fake/ffmpeg', spawnImpl: fakeFfmpeg('fail') }),
    ).rejects.toThrow(/saiu com 1/);
  });
});

describe('store voiceClone — consent-first, por-utilizador', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('sem amostra -> null; toggle sem amostra -> false', () => {
    expect(getClone(db, 'u1')).toBeNull();
    expect(setCloneEnabled(db, 'u1', true)).toBe(false);
  });

  it('saveClone regista amostra + consentimento; enabled começa off', () => {
    saveClone(db, 'u1', '/x/u1.wav', 123);
    expect(getClone(db, 'u1')).toEqual({ samplePath: '/x/u1.wav', consentAt: 123, enabled: false });
  });

  it('toggle liga/desliga; regravar PRESERVA o enabled', () => {
    saveClone(db, 'u1', '/x/a.wav', 1);
    expect(setCloneEnabled(db, 'u1', true)).toBe(true);
    expect(getClone(db, 'u1')!.enabled).toBe(true);
    saveClone(db, 'u1', '/x/b.wav', 2); // regravação
    const c = getClone(db, 'u1')!;
    expect(c.samplePath).toBe('/x/b.wav');
    expect(c.consentAt).toBe(2);
    expect(c.enabled).toBe(true); // preservado
  });

  it('delete devolve o caminho e apaga o registo; delete sem nada -> null', () => {
    saveClone(db, 'u1', '/x/a.wav', 1);
    expect(deleteClone(db, 'u1')).toBe('/x/a.wav');
    expect(getClone(db, 'u1')).toBeNull();
    expect(deleteClone(db, 'u1')).toBeNull();
  });

  it('é por-utilizador (global, sem guild)', () => {
    saveClone(db, 'u1', '/x/a.wav', 1);
    expect(getClone(db, 'u2')).toBeNull();
  });
});
