import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloneEngine, parseCommand, resolveCloneCmd } from '../src/tts/cloneEngine';
import { AudioCache } from '../src/tts/cache';
import type { SynthRequest, TTSEngine } from '../src/tts/engine';

describe('parseCommand', () => {
  it('splits exe + args and respects quotes in the path', () => {
    expect(parseCommand('python script.py --x')).toEqual({
      exe: 'python',
      args: ['script.py', '--x'],
    });
    expect(parseCommand('"C:\\Program Files\\py.exe" a.py')).toEqual({
      exe: 'C:\\Program Files\\py.exe',
      args: ['a.py'],
    });
  });
});

describe('resolveCloneCmd', () => {
  // `exists`/`cwd` injectable so it does not depend on the real venv of the test machine.
  // Paths built with join() to match the platform (Windows '\\', Linux '/').
  const CWD = join('/', 'proj');
  const PY_LINUX = join(CWD, 'tools', 'clone-venv', 'bin', 'python');
  const PY_WIN = join(CWD, 'tools', 'clone-venv', 'Scripts', 'python.exe');
  const SERVER = join(CWD, 'tools', 'clone_server.py');

  it('explicit CLONE_CMD wins (parses exe + args)', () => {
    expect(resolveCloneCmd('py serve.py')).toEqual({ exe: 'py', args: ['serve.py'] });
  });

  it('venv Linux (bin/python) + server present -> command', () => {
    const cmd = resolveCloneCmd(undefined, {
      cwd: CWD,
      exists: (p) => p === PY_LINUX || p === SERVER,
    });
    expect(cmd).toEqual({ exe: PY_LINUX, args: [SERVER] });
  });

  it('venv Windows (Scripts/python.exe) is also detected', () => {
    const cmd = resolveCloneCmd(undefined, {
      cwd: CWD,
      exists: (p) => p === PY_WIN || p === SERVER,
    });
    expect(cmd).toEqual({ exe: PY_WIN, args: [SERVER] });
  });

  it('no venv -> null (clone inert)', () => {
    expect(resolveCloneCmd(undefined, { cwd: CWD, exists: (p) => p === SERVER })).toBeNull();
  });

  it('no clone_server.py -> null', () => {
    expect(resolveCloneCmd(undefined, { cwd: CWD, exists: (p) => p === PY_LINUX })).toBeNull();
  });
});

/**
 * FAKE Python sidecar: an EventEmitter with stdin.write that responds to the protocol —
 * warmup -> {ready}; request -> writes the WAV to `out` and responds {ok,out} (or {ok:false}
 * if behavior='fail'; or nothing if 'hang').
 */
function fakeSidecar(
  behavior: 'ok' | 'fail' | 'hang' | 'never-ready' = 'ok',
  counter?: { spawns: number },
) {
  return (() => {
    if (counter) counter.spawns++;
    const child = new EventEmitter() as EventEmitter & {
      stdin: { write: (s: string) => void };
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    child.stdin = {
      write: (s: string) => {
        const req = JSON.parse(s.trim());
        queueMicrotask(() => {
          if (req.warmup) {
            if (behavior === 'never-ready') return; // wedged: never responds {ready}
            child.stdout.emit(
              'data',
              Buffer.from(JSON.stringify({ ok: true, ready: true, model: 'en' }) + '\n'),
            );
            return;
          }
          if (behavior === 'hang' || behavior === 'never-ready') return;
          if (behavior === 'ok') {
            writeFileSync(req.out, Buffer.from('RIFFcloned'));
            child.stdout.emit(
              'data',
              Buffer.from(JSON.stringify({ ok: true, out: req.out }) + '\n'),
            );
          } else {
            child.stdout.emit(
              'data',
              Buffer.from(JSON.stringify({ ok: false, error: 'model boom' }) + '\n'),
            );
          }
        });
      },
    };
    return child;
  }) as any;
}

const REQ = (extra: Partial<SynthRequest> = {}): SynthRequest => ({
  text: 'ola',
  model: 'pt_PT-tugao-medium',
  speed: 1,
  ...extra,
});
const innerReturning = (p: string): TTSEngine => ({ synth: async () => p });

describe('CloneEngine', () => {
  const dirs: string[] = [];
  const cache = () => {
    const d = mkdtempSync(join(tmpdir(), 'clone-cache-'));
    dirs.push(d);
    return new AudioCache(d);
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('no cloneRef -> normal voice (inner), without touching the sidecar', async () => {
    const eng = new CloneEngine(
      innerReturning('/normal.wav'),
      cache(),
      { exe: 'x', args: [] },
      fakeSidecar('ok'),
    );
    expect(await eng.synth(REQ())).toBe('/normal.wav');
  });

  it('no engine (cmd null) -> normal voice even with cloneRef', async () => {
    const eng = new CloneEngine(innerReturning('/normal.wav'), cache(), null);
    expect(eng.available).toBe(false);
    expect(await eng.synth(REQ({ cloneRef: '/ref.wav' }))).toBe('/normal.wav');
  });

  it('with cloneRef -> synthesizes via sidecar and caches (2nd = hit)', async () => {
    const eng = new CloneEngine(
      innerReturning('/normal.wav'),
      cache(),
      { exe: 'x', args: [] },
      fakeSidecar('ok'),
    );
    const out1 = await eng.synth(REQ({ cloneRef: '/ref.wav' }));
    expect(out1).not.toBe('/normal.wav'); // came from the clone, went into the cache
    const out2 = await eng.synth(REQ({ cloneRef: '/ref.wav' }));
    expect(out2).toBe(out1); // cache-hit
  });

  it('CRITICAL: sidecar failure -> falls back to normal voice (never throws)', async () => {
    const eng = new CloneEngine(
      innerReturning('/normal.wav'),
      cache(),
      { exe: 'x', args: [] },
      fakeSidecar('fail'),
    );
    await expect(eng.synth(REQ({ cloneRef: '/ref.wav' }))).resolves.toBe('/normal.wav');
  });

  it('REGRESSION: re-recording (different ref) does NOT serve the old voice from cache', async () => {
    const eng = new CloneEngine(
      innerReturning('/normal.wav'),
      cache(),
      { exe: 'x', args: [] },
      fakeSidecar('ok'),
    );
    const a = await eng.synth(REQ({ text: 'hello', cloneRef: '/clones/u1-1000.wav' }));
    // same phrase, BUT re-recorded sample (different versioned path) -> new key
    const b = await eng.synth(REQ({ text: 'hello', cloneRef: '/clones/u1-2000.wav' }));
    expect(b).not.toBe(a); // not the hit of the old sample
  });

  it('BUG-01: sidecar alive but never ready -> deadline expires, job rejects and falls back to normal voice', async () => {
    const eng = new CloneEngine(
      innerReturning('/normal.wav'),
      cache(),
      { exe: 'x', args: [] },
      fakeSidecar('never-ready'),
      30, // short deadline for the test
    );
    // Without a deadline this would stay PENDING forever (that was the bug).
    await expect(eng.synth(REQ({ cloneRef: '/ref.wav' }))).resolves.toBe('/normal.wav');
  });

  it('BUG-01: ready within the deadline -> timer cleared, NO spurious teardown (only 1 spawn)', async () => {
    const counter = { spawns: 0 };
    const eng = new CloneEngine(
      innerReturning('/normal.wav'),
      cache(),
      { exe: 'x', args: [] },
      fakeSidecar('ok', counter),
      50,
    );
    const a = await eng.synth(REQ({ text: 'um', cloneRef: '/ref.wav' }));
    expect(a).not.toBe('/normal.wav'); // came from the clone
    // Wait past the deadline: if the timer had NOT been cleared, restart()
    // would kill the sidecar and the next spawn would count 2.
    await new Promise((r) => setTimeout(r, 80));
    const b = await eng.synth(REQ({ text: 'dois', cloneRef: '/ref.wav' }));
    expect(b).not.toBe('/normal.wav');
    expect(counter.spawns).toBe(1); // never restarted
  });
});
