// src/voice/whisperSidecar.ts
//
// Resolução do comando do SIDECAR de STT (Whisper local, Fase 4). Espelha o
// resolveKokoroCmd: auto-deteta o venv Python + o script do sidecar em tools/. Se algo
// faltar devolve null (=> o STT fica INERTE; o comando de transcrição responde "indisponível"
// em vez de crashar). O sidecar (tools/whisper_sidecar.py) é um processo PERSISTENTE que
// carrega o modelo faster-whisper UMA vez e transcreve N pedidos (padrão clone/kokoro).
//
// Spike (docs/SPIKE-STT.md): faster-whisper `base` int8 no VPS = ~2.2s por ~13.6s de fala,
// muito abaixo do limiar de 5s. `base` é o default (melhor precisão; latência sobra).

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Modelo por defeito do Whisper (ver spike). Trocável por WHISPER_MODEL na env. */
export const DEFAULT_WHISPER_MODEL = 'base';

export interface ResolveWhisperDeps {
  /** Injetável nos testes; em produção é fs.existsSync. */
  exists?: (p: string) => boolean;
  /** Raiz do projeto; default process.cwd(). */
  cwd?: string;
}

/**
 * Resolve o comando do sidecar Whisper. `model` = tamanho do modelo (tiny/base/small…).
 * Devolve `{ exe, args }` (exe = python do venv; args = [script, model]) ou null se o venv
 * ou o script não existirem nesta instância. PURO (só faz existsSync).
 */
export function resolveWhisperCmd(
  model: string = DEFAULT_WHISPER_MODEL,
  deps: ResolveWhisperDeps = {},
): { exe: string; args: string[] } | null {
  const exists = deps.exists ?? existsSync;
  const cwd = deps.cwd ?? process.cwd();
  // O python do venv: Scripts/python.exe (Windows) ou bin/python (Linux/VPS) — tenta os dois.
  const venvPy = [
    join(cwd, 'tools', 'whisper-venv', 'Scripts', 'python.exe'),
    join(cwd, 'tools', 'whisper-venv', 'bin', 'python'),
  ].find((p) => exists(p));
  const script = join(cwd, 'tools', 'whisper_sidecar.py');
  if (!venvPy || !exists(script)) return null;
  return { exe: venvPy, args: [script, '--model', String(model)] };
}
