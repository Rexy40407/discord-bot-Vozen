// src/voice/utteranceCollector.ts
//
// Segmentador de UTTERANCES para o STT (Fase 4). Recebe frames PCM (decodificados do Opus
// de UM locutor — ver recorder.ts) e agrupa-os em utterances: fecha uma quando há um GAP de
// silêncio depois de fala (`silenceGapMs`) OU ao atingir o teto (`maxUtteranceMs`). Silêncio
// pré-fala é ignorado; blips demasiado curtos (< `minUtteranceMs` de VOZ) são descartados
// (rejeição de ruído). PURO/testável (alimentado com buffers), sem IO nem rede.
//
// Difere do VoicedCollector do recorder (que descarta silêncio para juntar 15s de amostra de
// clone): aqui preservamos o silêncio INTERNO da utterance (fronteiras naturais para o
// Whisper) e emitimos por-utterance em vez de um buffer único.

export interface Utterance {
  /** PCM da utterance (do 1.º frame vozeado até ao gap que a fechou). */
  pcm: Buffer;
  /** Duração total (ms), incluindo silêncio interno. */
  ms: number;
  /** Só os ms de FALA (RMS acima do chão) — usado para rejeitar blips e p/ diagnóstico. */
  voicedMs: number;
}

export interface UtteranceOpts {
  /** Bytes por ms do formato PCM (48kHz estéreo s16le = 192; testes usam 2). Default 192. */
  bytesPerMs?: number;
  /** Chão de RMS (int16) acima do qual um frame conta como FALA. Default 350 (≈ recorder). */
  rmsThreshold?: number;
  /** Silêncio contínuo (ms) depois de fala que FECHA a utterance. Default 800. */
  silenceGapMs?: number;
  /** Mínimo de FALA (ms) para uma utterance valer — abaixo disto descarta-se. Default 300. */
  minUtteranceMs?: number;
  /** Teto (ms) que força o fecho de um monólogo longo. Default 20000. */
  maxUtteranceMs?: number;
}

export class UtteranceCollector {
  private readonly bytesPerMs: number;
  private readonly rmsThreshold: number;
  private readonly silenceGapMs: number;
  private readonly minUtteranceMs: number;
  private readonly maxUtteranceMs: number;

  private chunks: Buffer[] = [];
  private totalMs = 0;
  private voicedMs = 0;
  private silenceRunMs = 0;
  private inUtterance = false;

  constructor(opts: UtteranceOpts = {}) {
    this.bytesPerMs = opts.bytesPerMs ?? 192;
    this.rmsThreshold = opts.rmsThreshold ?? 350;
    this.silenceGapMs = opts.silenceGapMs ?? 800;
    this.minUtteranceMs = opts.minUtteranceMs ?? 300;
    this.maxUtteranceMs = opts.maxUtteranceMs ?? 20000;
  }

  /**
   * Alimenta um frame PCM. Devolve uma Utterance quando uma acaba de fechar (gap de silêncio
   * ou teto atingido), senão null. Um blip curto que atinja o gap é descartado (null).
   */
  push(frame: Buffer): Utterance | null {
    const frameMs = frame.length / this.bytesPerMs;
    const voiced = this.rmsOf(frame) >= this.rmsThreshold;

    if (voiced) {
      this.inUtterance = true;
      this.chunks.push(frame);
      this.totalMs += frameMs;
      this.voicedMs += frameMs;
      this.silenceRunMs = 0;
      // Monólogo longo: fecha à força (ainda que sem gap) para não crescer sem limite.
      return this.totalMs >= this.maxUtteranceMs ? this.close() : null;
    }

    // Silêncio antes de qualquer fala: ignora (não arranca utterance).
    if (!this.inUtterance) return null;

    this.chunks.push(frame);
    this.totalMs += frameMs;
    this.silenceRunMs += frameMs;
    if (this.silenceRunMs >= this.silenceGapMs) {
      // Fim da utterance: emite se teve fala suficiente, senão descarta (ruído/blip).
      if (this.voicedMs >= this.minUtteranceMs) return this.close();
      this.reset();
    }
    return null;
  }

  /** Fecha e devolve a utterance pendente (se válida) — chamar quando a gravação pára. */
  flush(): Utterance | null {
    if (this.inUtterance && this.voicedMs >= this.minUtteranceMs) return this.close();
    this.reset();
    return null;
  }

  private close(): Utterance {
    const u: Utterance = {
      pcm: Buffer.concat(this.chunks),
      ms: Math.round(this.totalMs),
      voicedMs: Math.round(this.voicedMs),
    };
    this.reset();
    return u;
  }

  private reset(): void {
    this.chunks = [];
    this.totalMs = 0;
    this.voicedMs = 0;
    this.silenceRunMs = 0;
    this.inUtterance = false;
  }

  private rmsOf(buf: Buffer): number {
    const n = Math.floor(buf.length / 2);
    if (n === 0) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const s = buf.readInt16LE(i * 2);
      sum += s * s;
    }
    return Math.sqrt(sum / n);
  }
}
