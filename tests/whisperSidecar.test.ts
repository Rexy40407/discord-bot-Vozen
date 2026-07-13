import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { resolveWhisperCmd, DEFAULT_WHISPER_MODEL } from '../src/voice/whisperSidecar';

// Resolução do comando do sidecar Whisper (STT). `exists` injetável para não depender do venv.
// Paths construídos com join() para bater com a plataforma (Windows usa '\\', Linux '/').
const CWD = join('/', 'proj');
const PY_LINUX = join(CWD, 'tools', 'whisper-venv', 'bin', 'python');
const PY_WIN = join(CWD, 'tools', 'whisper-venv', 'Scripts', 'python.exe');
const SCRIPT = join(CWD, 'tools', 'whisper_sidecar.py');

describe('resolveWhisperCmd', () => {
  it('venv (bin/python) + script presentes -> comando com --model', () => {
    const cmd = resolveWhisperCmd('base', {
      cwd: CWD,
      exists: (p) => p === PY_LINUX || p === SCRIPT,
    });
    expect(cmd).not.toBeNull();
    expect(cmd!.exe).toBe(PY_LINUX);
    expect(cmd!.args).toEqual([SCRIPT, '--model', 'base']);
  });

  it('venv Windows (Scripts/python.exe) também é detetado', () => {
    const cmd = resolveWhisperCmd('tiny', {
      cwd: CWD,
      exists: (p) => p === PY_WIN || p === SCRIPT,
    });
    expect(cmd!.exe).toBe(PY_WIN);
    expect(cmd!.args[2]).toBe('tiny');
  });

  it('sem venv -> null (STT inerte)', () => {
    expect(resolveWhisperCmd('base', { cwd: CWD, exists: (p) => p === SCRIPT })).toBeNull();
  });

  it('sem script -> null', () => {
    expect(resolveWhisperCmd('base', { cwd: CWD, exists: (p) => p === PY_LINUX })).toBeNull();
  });

  it('modelo default é base', () => {
    expect(DEFAULT_WHISPER_MODEL).toBe('base');
    const cmd = resolveWhisperCmd(undefined, {
      cwd: CWD,
      exists: (p) => p === PY_LINUX || p === SCRIPT,
    });
    expect(cmd!.args).toContain('base');
  });
});
