// src/tts/engine.ts
export interface SynthRequest {
  text: string;
  model: string;
  speed: number;
}

export interface TTSEngine {
  synth(req: SynthRequest): Promise<string>; // devolve caminho absoluto de um .wav
}
