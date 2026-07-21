import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  resolveWhisperCmd,
  resolveWhisperBeamSize,
  DEFAULT_WHISPER_MODEL,
} from '../src/voice/whisperSidecar';

// Resolution of the Whisper sidecar command (STT). `exists` is injectable so it doesn't depend on the venv.
// Paths built with join() to match the platform (Windows uses '\\', Linux '/').
const CWD = join('/', 'proj');
const PY_LINUX = join(CWD, 'tools', 'whisper-venv', 'bin', 'python');
const PY_WIN = join(CWD, 'tools', 'whisper-venv', 'Scripts', 'python.exe');
const SCRIPT = join(CWD, 'tools', 'whisper_sidecar.py');

describe('resolveWhisperCmd', () => {
  it('venv (bin/python) + script present -> command with --model', () => {
    const cmd = resolveWhisperCmd('base', {
      cwd: CWD,
      env: {},
      exists: (p) => p === PY_LINUX || p === SCRIPT,
    });
    expect(cmd).not.toBeNull();
    expect(cmd!.exe).toBe(PY_LINUX);
    expect(cmd!.args).toEqual([SCRIPT, '--model', 'base', '--beam', '1']);
  });

  it('Windows venv (Scripts/python.exe) is detected too', () => {
    const cmd = resolveWhisperCmd('tiny', {
      cwd: CWD,
      env: { WHISPER_BEAM_SIZE: '3' },
      exists: (p) => p === PY_WIN || p === SCRIPT,
    });
    expect(cmd!.exe).toBe(PY_WIN);
    expect(cmd!.args[2]).toBe('tiny');
    expect(cmd!.args.slice(-2)).toEqual(['--beam', '3']);
  });

  it('no venv -> null (STT inert)', () => {
    expect(resolveWhisperCmd('base', { cwd: CWD, exists: (p) => p === SCRIPT })).toBeNull();
  });

  it('no script -> null', () => {
    expect(resolveWhisperCmd('base', { cwd: CWD, exists: (p) => p === PY_LINUX })).toBeNull();
  });

  it('default model is base', () => {
    expect(DEFAULT_WHISPER_MODEL).toBe('base');
    const cmd = resolveWhisperCmd(undefined, {
      cwd: CWD,
      env: {},
      exists: (p) => p === PY_LINUX || p === SCRIPT,
    });
    expect(cmd!.args).toContain('base');
  });
});

describe('resolveWhisperBeamSize', () => {
  it('defaults to greedy live transcription and accepts only 1-5', () => {
    expect(resolveWhisperBeamSize({})).toBe(1);
    expect(resolveWhisperBeamSize({ WHISPER_BEAM_SIZE: '3' })).toBe(3);
    for (const bad of ['0', '6', '1.5', 'abc']) {
      expect(resolveWhisperBeamSize({ WHISPER_BEAM_SIZE: bad })).toBe(1);
    }
  });
});
