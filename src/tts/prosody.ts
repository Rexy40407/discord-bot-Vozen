// src/tts/prosody.ts — ENTOAÇÃO DE PERGUNTA sintética (fazer o "?" soar a pergunta).
//
// PORQUÊ: a subida de tom no fim de uma pergunta que se ouve nalgumas línguas (ex.
// espanhol) é a voz NATIVA do Google, não uma feature — e varia por língua (o PT/EN da
// Google soam planos). Para dar a MESMA entoação de pergunta em TODAS as línguas e TODOS
// os motores, aplicamo-la nós: pegamos no WAV JÁ sintetizado e SOBEMOS o tom só no FIM
// (o "rabo" da fala), que é a assinatura acústica universal de uma pergunta.
//
// COMO: filtros CORE do ffmpeg (asetrate+aresample+atempo — os mesmos dos efeitos
// deep/chipmunk; nada de rubberband, que pode não vir compilado no ffmpeg-static).
// Cortamos os últimos ~QUESTION_TAIL_MS em JS (o WAV é sempre 22050/mono/16-bit — o
// formato canónico do gTTS e do Piper), damos pitch SÓ a esse pedaço, e concatenamos
// [corpo + rabo-agudo].
//
// Motor-DECORADOR (mesmo padrão do EffectEngine) com cache própria (namespace 'q') e
// FAIL-SAFE: qualquer erro devolve a voz LIMPA — NUNCA lança (uma síntese que lança faz
// o player SALTAR a fala => silêncio). Só corre quando a fala ACABA em `?` (o `?` alinha
// com o rabo do áudio). Motores que não produzem 22050/mono/16 (ex. clone/Kokoro a 24k)
// caem no fail-safe (splitTailWav devolve null) e ficam sem entoação — sem crashar.

import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import type { SynthRequest, TTSEngine } from './engine';
import { AudioCache, cacheKey } from './cache';
import { applyEffect, type ApplyEffectDeps } from './effects';
import { parseWav, buildWav, concatWavs } from './wavConcat';
import { rmDirSafe } from './cleanupDir';
import { log } from '../logging/logger';

// Formato canónico (gTTS/Piper). O split assume-o; splitTailWav valida-o e cai fora se não bater.
const SR = 22050;
const CHANNELS = 1;
const BITS = 16;
const BLOCK_ALIGN = (CHANNELS * BITS) / 8; // 2 bytes por sample-frame (mono 16-bit)

// TUNÁVEL: quanto do FIM leva a subida (ms) e quão AGUDO fica (multiplicador de pitch).
// 500 ms ~= a última palavra/sílaba; 1.10 = +10% de tom. Mais alto soa a "chipmunk" no
// rabo; mais baixo passa despercebido. Se soar artificial, é aqui que se afina.
const QUESTION_TAIL_MS = 500;
const QUESTION_PITCH = 1.1;

// asetrate acelera+agudiza; aresample volta a 22050; atempo=1/pitch repõe a DURAÇÃO sem
// baixar o tom. Resultado: mesmo tamanho, tom mais agudo (igual à mecânica do deep/chipmunk).
export const QUESTION_FILTER = `asetrate=${SR}*${QUESTION_PITCH},aresample=${SR},atempo=${(
  1 / QUESTION_PITCH
).toFixed(4)}`;

/** A fala ACABA numa pergunta? (`?` no fim, tolerando aspas/parênteses/espaços a seguir). PURA. */
export function isQuestion(text: string): boolean {
  return /\?["'”»)\]\s]*$/u.test(text);
}

/**
 * Parte o WAV em [corpo, rabo] onde o rabo são os últimos `tailMs` ms, cada um já como
 * WAV canónico. Devolve `null` se o input não for 22050/mono/16-bit PCM (ex. clone a 24k)
 * — o chamador cai então na voz limpa. Corte alinhado à sample-frame. PURA.
 */
export function splitTailWav(wav: Buffer, tailMs: number): { head: Buffer; tail: Buffer } | null {
  let parsed;
  try {
    parsed = parseWav(wav, 0);
  } catch {
    return null; // não é um WAV RIFF válido
  }
  if (
    parsed.audioFormat !== 1 ||
    parsed.sampleRate !== SR ||
    parsed.channels !== CHANNELS ||
    parsed.bits !== BITS
  ) {
    return null; // formato inesperado -> sem entoação (fail-safe a montante)
  }
  const data = parsed.data;
  const tailFrames = Math.round((tailMs / 1000) * SR);
  const tailBytes = Math.min(data.length, tailFrames * BLOCK_ALIGN);
  const splitAt = data.length - tailBytes;
  return {
    head: buildWav(data.subarray(0, splitAt)), // vazio quando a fala é toda "rabo" (curta)
    tail: buildWav(data.subarray(splitAt)),
  };
}

/**
 * Motor decorador que dá ENTOAÇÃO DE PERGUNTA às falas que acabam em `?`: sobe o tom no
 * fim via ffmpeg, com cache própria (namespace 'q', keyed por cacheKey(req)+'_q' — como o
 * EffectEngine). Falas sem `?` passam intactas. Qualquer erro -> voz LIMPA (nunca lança).
 */
export class ProsodyEngine implements TTSEngine {
  constructor(
    private readonly inner: TTSEngine,
    private readonly cache: AudioCache,
    private readonly deps: ApplyEffectDeps = {},
  ) {}

  async synth(req: SynthRequest): Promise<string> {
    const base = await this.inner.synth(req);
    if (!isQuestion(req.text)) return base;

    const key = `${cacheKey(req)}_q`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    let workDir: string | null = null;
    let pitchedDir: string | null = null;
    try {
      const split = splitTailWav(readFileSync(base), QUESTION_TAIL_MS);
      if (!split) return base; // formato inesperado -> voz limpa

      workDir = mkdtempSync(join(tmpdir(), 'vozen-q-'));
      const tailPath = join(workDir, 'tail.wav');
      writeFileSync(tailPath, split.tail);

      const pitchedPath = await applyEffect(tailPath, QUESTION_FILTER, this.deps);
      pitchedDir = dirname(pitchedPath);
      const out = concatWavs([split.head, readFileSync(pitchedPath)], { silenceMs: 0 });

      const outPath = join(workDir, 'out.wav');
      writeFileSync(outPath, out);
      return this.cache.put(key, outPath);
    } catch (err) {
      log.warn('[prosody] entoação de pergunta falhou, a servir voz limpa:', err);
      return base;
    } finally {
      // applyEffect NÃO limpa o seu dir em sucesso (é o chamador que copia e limpa); o
      // cache.put já copiou o out.wav do workDir, por isso podemos limpar ambos.
      if (pitchedDir) rmDirSafe(pitchedDir);
      if (workDir) rmDirSafe(workDir);
    }
  }
}
