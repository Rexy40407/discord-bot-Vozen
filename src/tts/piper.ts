// src/tts/piper.ts
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SynthRequest, TTSEngine } from './engine';
import { AudioCache, cacheKey } from './cache';

const PIPER_TIMEOUT_MS = 15000;

export class PiperEngine implements TTSEngine {
  private readonly piperPath: string;
  private readonly modelsDir: string;
  private readonly cache: AudioCache;

  constructor(piperPath: string, modelsDir: string, cache: AudioCache) {
    this.piperPath = piperPath;
    this.modelsDir = modelsDir;
    this.cache = cache;
  }

  async synth(req: SynthRequest): Promise<string> {
    const key = cacheKey(req);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const modelPath = join(this.modelsDir, `${req.model}.onnx`);
    if (!existsSync(modelPath)) {
      throw new Error(`Modelo Piper nao encontrado: ${modelPath}`);
    }

    const speed = req.speed > 0 ? req.speed : 1;
    const lengthScale = 1 / speed; // Piper: length_scale baixo = mais rapido

    const workDir = mkdtempSync(join(tmpdir(), 'piper-'));
    const outPath = join(workDir, 'out.wav');

    try {
      await this.runPiper(modelPath, outPath, lengthScale, req.text);

      if (!existsSync(outPath) || statSync(outPath).size === 0) {
        throw new Error('Piper nao gerou WAV (ficheiro vazio ou inexistente)');
      }

      return this.cache.put(key, outPath);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  private runPiper(
    modelPath: string,
    outPath: string,
    lengthScale: number,
    text: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const args = [
        '--model',
        modelPath,
        '--output_file',
        outPath,
        '--length_scale',
        String(lengthScale),
      ];

      const child = spawn(this.piperPath, args, {
        stdio: ['pipe', 'ignore', 'pipe'],
      });

      let settled = false;
      let stderr = '';

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        reject(new Error(`Piper timeout (${PIPER_TIMEOUT_MS}ms)`));
      }, PIPER_TIMEOUT_MS);

      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Falha ao iniciar Piper: ${err.message}`));
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Piper saiu com codigo ${code}: ${stderr.trim()}`));
        }
      });

      // Texto a sintetizar vai pelo stdin (uma linha).
      child.stdin?.write(text.endsWith('\n') ? text : `${text}\n`);
      child.stdin?.end();
    });
  }
}
