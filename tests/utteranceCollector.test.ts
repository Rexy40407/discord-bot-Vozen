import { describe, it, expect } from 'vitest';
import { UtteranceCollector } from '../src/voice/utteranceCollector';

// Segmentador de UTTERANCES para o STT: acumula frames PCM e fecha uma utterance quando há
// um GAP de silêncio depois de fala (ou ao atingir o teto). Ver src/voice/utteranceCollector.
// Nos testes usamos bytesPerMs=2 (1 sample int16 = 1 ms) para contas simples.

const BPM = 2;
/** Frame PCM de `ms` (int16 LE): amostras a 6000 (fala, RMS>>threshold) ou 0 (silêncio). */
function frame(ms: number, voiced: boolean): Buffer {
  const b = Buffer.alloc(ms * BPM);
  if (voiced) for (let i = 0; i < ms; i++) b.writeInt16LE(6000, i * 2);
  return b;
}
function make() {
  return new UtteranceCollector({
    bytesPerMs: BPM,
    rmsThreshold: 350,
    silenceGapMs: 100,
    minUtteranceMs: 50,
    maxUtteranceMs: 1000,
  });
}

describe('UtteranceCollector — segmentação por silêncio', () => {
  it('só silêncio -> nada (silêncio pré-fala é ignorado)', () => {
    const c = make();
    expect(c.push(frame(200, false))).toBeNull();
    expect(c.flush()).toBeNull();
  });

  it('fala + gap de silêncio -> emite uma utterance', () => {
    const c = make();
    expect(c.push(frame(200, true))).toBeNull();
    const u = c.push(frame(100, false)); // 100ms silêncio >= gap 100, voz 200 >= min 50
    expect(u).not.toBeNull();
    expect(u!.voicedMs).toBe(200);
  });

  it('duas utterances separadas por gap -> dois emits', () => {
    const c = make();
    expect(c.push(frame(150, true))).toBeNull();
    const u1 = c.push(frame(120, false));
    expect(u1!.voicedMs).toBe(150);
    expect(c.push(frame(150, true))).toBeNull();
    const u2 = c.push(frame(120, false));
    expect(u2!.voicedMs).toBe(150);
  });

  it('blip curto (< minUtteranceMs) é descartado', () => {
    const c = make();
    expect(c.push(frame(30, true))).toBeNull(); // 30ms de fala
    expect(c.push(frame(120, false))).toBeNull(); // gap, mas 30 < min 50 -> descarta
    expect(c.flush()).toBeNull();
  });

  it('monólogo longo -> fecho forçado ao atingir o teto', () => {
    const c = make();
    expect(c.push(frame(600, true))).toBeNull();
    const u = c.push(frame(600, true)); // total 1200 >= max 1000 -> fecha
    expect(u).not.toBeNull();
    expect(u!.voicedMs).toBe(1200);
  });

  it('flush emite a utterance final pendente (sem gap)', () => {
    const c = make();
    expect(c.push(frame(200, true))).toBeNull();
    const u = c.flush();
    expect(u!.voicedMs).toBe(200);
  });

  it('gap NO MEIO da fala não parte a utterance (silêncio curto < gap)', () => {
    const c = make();
    expect(c.push(frame(120, true))).toBeNull();
    expect(c.push(frame(60, false))).toBeNull(); // 60 < gap 100 -> continua
    expect(c.push(frame(120, true))).toBeNull();
    const u = c.push(frame(100, false)); // agora fecha
    expect(u!.voicedMs).toBe(240); // 120 + 120
  });
});
