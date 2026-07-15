// src/tts/cloneEngine.ts
//
// VOICE CLONE engine: wraps the normal engine from the OUTSIDE (like EffectEngine) and, when
// the user has clone ON (req.cloneRef present), synthesizes the speech in the cloned voice
// via a persistent Python sidecar (tools/clone_server.py — Chatterbox, GPU). ANY
// failure (sidecar down, timeout, model error) falls back to the NORMAL voice — never silence.
//
// Own cache (namespace 'clone', keyed by cacheKey+refBasename): the same phrase in the
// same cloned voice is reused; the LRU cleans up. The sidecar runs 1 request at a time
// (GPU): we serialize with an internal FIFO queue.

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { AudioCache, cacheKey } from './cache';
import { materializeSampleForSidecar, cleanupMaterialized } from './cloneSampleFile';
import { lowerAllCapsRuns } from './deCaps';
import type { SynthRequest, TTSEngine } from './engine';
import { langKeyOfModel } from '../language/spokenPhrases';
import { log } from '../logging/logger';

/** Maximum time per cloned synthesis (the 1st request loads the model — hence generous). */
const SYNTH_TIMEOUT_MS = 60_000;

/**
 * Maximum time waiting for the warmup's {ready}. Loading the model on GPU is slow
 * (~35s cold — see prewarm()), hence a generous ceiling; but a live sidecar that
 * NEVER becomes ready cannot hold the queue forever.
 */
const READY_TIMEOUT_MS = 120_000;

interface Job {
  line: string;
  outPath: string;
  resolve: (p: string) => void;
  reject: (e: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Splits a command "python.exe script.py --flag" into [exe, ...args] respecting path
 * quotes (Windows: "C:\Program Files\..."). PURE.
 */
export function parseCommand(cmd: string): { exe: string; args: string[] } {
  const parts = cmd.match(/"[^"]+"|\S+/g) ?? [];
  const clean = parts.map((p) => (p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p));
  return { exe: clean[0] ?? '', args: clean.slice(1) };
}

export interface ResolveCloneDeps {
  /** Injectable in tests; in production it's fs.existsSync. */
  exists?: (p: string) => boolean;
  /** Project root; default process.cwd(). */
  cwd?: string;
}

/**
 * Resolves the sidecar command: uses CLONE_CMD if given, otherwise AUTO-DETECTS the venv in
 * tools/clone-venv (created by setup-clone). Returns null if nothing is installed
 * (=> the clone engine stays inert and always serves the normal voice).
 *
 * The venv's python is at Scripts/python.exe (Windows) OR bin/python (Linux/VPS) —
 * tries both (the STT sidecar already did this; the clone one only looked at Windows, so
 * on the Linux VPS the clone was NEVER detected even with the venv there).
 */
export function resolveCloneCmd(
  explicit: string | undefined,
  deps: ResolveCloneDeps = {},
): { exe: string; args: string[] } | null {
  if (explicit && explicit.trim()) return parseCommand(explicit.trim());
  const exists = deps.exists ?? existsSync;
  const cwd = deps.cwd ?? process.cwd();
  const venvPy = [
    join(cwd, 'tools', 'clone-venv', 'Scripts', 'python.exe'),
    join(cwd, 'tools', 'clone-venv', 'bin', 'python'),
  ].find((p) => exists(p));
  const server = join(cwd, 'tools', 'clone_server.py');
  if (venvPy && exists(server)) return { exe: venvPy, args: [server] };
  return null;
}

export class CloneEngine implements TTSEngine {
  private child: ChildProcess | null = null;
  private readonly queue: Job[] = [];
  private active: Job | null = null;
  private buffer = '';
  private ready = false;
  private starting = false;
  private tmpSeq = 0;
  private warmupTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly inner: TTSEngine,
    private readonly cache: AudioCache,
    private readonly cmd: { exe: string; args: string[] } | null,
    // spawn injection for tests (default: real child_process.spawn).
    private readonly spawnImpl: typeof spawn = spawn,
    // Warmup deadline injectable for tests (default: READY_TIMEOUT_MS).
    private readonly readyTimeoutMs: number = READY_TIMEOUT_MS,
    // Key to decrypt samples encrypted at rest before passing them to the sidecar
    // (which reads the file by path). Absent => plaintext samples (backward-compatible).
    private readonly cloneKey?: Buffer,
  ) {}

  /** Is there a clone engine installed on this instance? */
  get available(): boolean {
    return this.cmd !== null;
  }

  /**
   * Starts the sidecar and loads the model NOW, instead of waiting for the 1st cloned message
   * (which would otherwise pay ~35s of GPU cold-load, giving the sense of "it doesn't work"). No-op
   * if there is no engine; any failure is absorbed by ensureChild itself (falls back to the normal
   * voice as always). Called once at the bot's startup.
   */
  prewarm(): void {
    if (this.cmd) this.ensureChild();
  }

  async synth(req: SynthRequest): Promise<string> {
    // No clone requested, or no engine -> normal voice (the usual path).
    if (!req.cloneRef || !this.cmd) return this.inner.synth(req);

    // cacheKey already includes the cloneRef (versioned basename) — re-recording gives a new key.
    const key = cacheKey(req);
    const hit = this.cache.get(key);
    if (hit) return hit;

    let tmp: string | null = null;
    // Plaintext sample for the sidecar: if encrypted at rest, decrypt to a temp
    // (the sidecar reads the file by path and cannot decrypt). Deleted in the finally.
    let ref: { path: string; temp: boolean } | null = null;
    try {
      const lang = langCode(req.model);
      ref = materializeSampleForSidecar(req.cloneRef, this.cloneKey);
      // lowerAllCapsRuns: prevents an UPPERCASE "shout" from coming out spelled (see
      // deCaps.ts). The cache key uses the ORIGINAL req (above).
      tmp = await this.enqueue(lowerAllCapsRuns(req.text), ref.path, lang);
      return this.cache.put(key, tmp); // copies to the cache (stable key)
    } catch (err) {
      log.warn('[clone] cloned synthesis failed; using the normal voice:', err);
      return this.inner.synth(req); // NEVER silence
    } finally {
      if (tmp) {
        try {
          rmSync(tmp, { force: true });
        } catch {
          // best-effort
        }
      }
      if (ref) cleanupMaterialized(ref);
    }
  }

  private enqueue(text: string, ref: string, lang: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      // The sidecar writes the WAV to this temp; cache.put copies it and then we delete it.
      const outPath = join(tmpdir(), `vozen-clone-${process.pid}-${this.tmpSeq++}.wav`);
      const line = JSON.stringify({ text, ref, out: outPath, lang }) + '\n';
      this.queue.push({ line, outPath, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    if (this.active || this.queue.length === 0) return;
    if (!this.ensureChild()) {
      const err = new Error('clone: sidecar unavailable');
      for (const j of this.queue.splice(0)) j.reject(err);
      return;
    }
    if (!this.ready) return; // waiting for warmup; onLine calls pump() when ready
    const job = this.queue.shift()!;
    this.active = job;
    job.timer = setTimeout(() => {
      if (this.active !== job) return;
      this.active = null;
      job.reject(new Error(`clone: timeout ${SYNTH_TIMEOUT_MS}ms`));
      this.restart(); // a stuck request kills the sidecar -> restarts clean
    }, SYNTH_TIMEOUT_MS);
    try {
      this.child!.stdin!.write(job.line);
    } catch (e) {
      if (job.timer) clearTimeout(job.timer);
      this.active = null;
      job.reject(e as Error);
      this.restart();
    }
  }

  private ensureChild(): boolean {
    if (this.child || this.starting) return true;
    if (!this.cmd) return false;
    try {
      this.starting = true;
      const child = this.spawnImpl(this.cmd.exe, this.cmd.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.child = child;
      child.stdout!.on('data', (c: Buffer) => this.onData(c));
      child.stderr!.on('data', (c: Buffer) => log.info(`[clone-py] ${c.toString().trim()}`));
      child.on('exit', (code) => {
        if (this.child !== child) return; // event from an ALREADY-replaced child — ignore
        log.warn(`[clone] sidecar exited (code ${code})`);
        this.teardown();
      });
      child.on('error', (err) => {
        if (this.child !== child) return; // event from an ALREADY-replaced child — ignore
        log.warn('[clone] sidecar failure:', err);
        this.teardown();
      });
      // Warmup: loads the model now; onLine sets this.ready and calls pump().
      child.stdin!.write(JSON.stringify({ warmup: true }) + '\n');
      // Warmup deadline: a live-but-never-ready sidecar held the jobs
      // forever (the !ready gate in pump() runs BEFORE the per-job timer). Expiring =>
      // restart(): kills the wedged process and the teardown rejects the queue — the callers
      // fall back to the normal voice, exactly as in the crash path.
      this.warmupTimer = setTimeout(() => {
        this.warmupTimer = null;
        if (this.ready) return; // benign race: became ready in the meantime
        log.warn(`[clone] sidecar was not ready after ${this.readyTimeoutMs}ms; restarting`);
        this.restart();
      }, this.readyTimeoutMs);
      // Don't keep the process alive just because of this timer (clean shutdown).
      this.warmupTimer.unref?.();
      return true;
    } catch (err) {
      log.warn('[clone] failed to start the sidecar:', err);
      this.starting = false;
      this.child = null;
      return false;
    }
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line) this.onLine(line);
    }
  }

  private onLine(line: string): void {
    let msg: { ok?: boolean; ready?: boolean; out?: string; error?: string };
    try {
      msg = JSON.parse(line);
    } catch {
      return; // non-protocol line (stray log) — ignore
    }
    if (msg.ready) {
      if (this.warmupTimer) {
        clearTimeout(this.warmupTimer);
        this.warmupTimer = null;
      }
      this.ready = true;
      this.starting = false;
      log.info('[clone] sidecar ready');
      this.pump();
      return;
    }
    const job = this.active;
    if (!job) return;
    this.active = null;
    if (job.timer) clearTimeout(job.timer);
    if (msg.ok && msg.out) job.resolve(msg.out);
    else job.reject(new Error(msg.error || 'clone: unknown error'));
    this.pump();
  }

  private teardown(): void {
    if (this.warmupTimer) {
      clearTimeout(this.warmupTimer);
      this.warmupTimer = null;
    }
    const err = new Error('clone: sidecar morreu');
    this.ready = false;
    this.starting = false;
    this.child = null;
    // Discards partial bytes from the dead process: otherwise they stick to the 1st line of
    // the respawned sidecar and break the JSON.parse (worst case: corrupt the `ready`).
    this.buffer = '';
    if (this.active) {
      if (this.active.timer) clearTimeout(this.active.timer);
      this.active.reject(err);
      this.active = null;
    }
    for (const j of this.queue.splice(0)) j.reject(err);
  }

  private restart(): void {
    try {
      this.child?.kill('SIGKILL');
    } catch {
      // already dead
    }
    this.teardown();
  }
}

/** Language code ('pt','en',...) from the model id, for the multilingual sidecar. */
function langCode(model: string): string {
  return langKeyOfModel(model).slice(0, 2).toLowerCase() || 'en';
}
