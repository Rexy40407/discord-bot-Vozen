import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gttsLangOfModel, chunkText, GTTSEngine } from '../src/tts/gtts';
import { createEngine } from '../src/tts/factory';
import { AudioCache } from '../src/tts/cache';
import type { AppConfig } from '../src/config/index';

describe('gttsLangOfModel — id de modelo Piper -> código tl do gTTS', () => {
  it('usa o prefixo antes do "_" (ISO-639-1)', () => {
    expect(gttsLangOfModel('pt_BR-cadu-medium')).toBe('pt'); // pt = Brasil no Google
    expect(gttsLangOfModel('en_US-amy-medium')).toBe('en');
    expect(gttsLangOfModel('es_ES-davefx-medium')).toBe('es');
    expect(gttsLangOfModel('fr_FR-siwis-medium')).toBe('fr');
    expect(gttsLangOfModel('ru_RU-denis-medium')).toBe('ru');
  });

  it('override do chinês (zh -> zh-CN) e fallback para inglês', () => {
    expect(gttsLangOfModel('zh_CN-chaowen-medium')).toBe('zh-CN');
    expect(gttsLangOfModel('semunderscore')).toBe('en');
    expect(gttsLangOfModel('')).toBe('en');
  });
});

describe('chunkText — parte por palavra respeitando o limite', () => {
  it('texto curto -> 1 pedaço', () => {
    expect(chunkText('ola amigos hello guys', 200)).toEqual(['ola amigos hello guys']);
  });

  it('texto vazio/só-espaços -> []', () => {
    expect(chunkText('', 200)).toEqual([]);
    expect(chunkText('   ', 200)).toEqual([]);
  });

  it('parte em fronteira de palavra e cada pedaço <= max', () => {
    const words = Array.from({ length: 60 }, (_, i) => `palavra${i}`).join(' ');
    const chunks = chunkText(words, 40);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(40);
    // Reconstrução por espaços preserva todas as palavras (nenhuma perdida/cortada).
    expect(chunks.join(' ').split(/\s+/)).toEqual(words.split(' '));
  });

  it('palavra maior que max é cortada à força', () => {
    const giant = 'x'.repeat(90);
    const chunks = chunkText(giant, 40);
    expect(chunks).toEqual(['x'.repeat(40), 'x'.repeat(40), 'x'.repeat(10)]);
  });
});

describe('createEngine — TTS_ENGINE=gtts seleciona o GTTSEngine', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  it('devolve um GTTSEngine (sem API key, sem Piper path)', () => {
    dir = mkdtempSync(join(tmpdir(), 'gttscache-'));
    const cache = new AudioCache(dir);
    const cfg = { ttsEngine: 'gtts', openaiApiKey: undefined } as unknown as AppConfig;
    expect(createEngine(cfg, cache)).toBeInstanceOf(GTTSEngine);
  });
});
