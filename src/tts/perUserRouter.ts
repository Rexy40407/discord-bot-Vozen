// src/tts/perUserRouter.ts
//
// Despacha cada síntese para o motor que o UTILIZADOR escolheu (`req.engine`): 'piper'
// -> Piper (self-host, local), 'kokoro' -> Kokoro (neural opt-in; já embrulhado num
// RouterEngine que cai no gTTS nas línguas que não suporta), qualquer outro / ausente
// -> Google (gTTS, o default de toda a gente). Os motores são construídos no arranque;
// o router só encaminha. Mesmo contrato TTSEngine, por isso vive por baixo do
// MultiSegmentEngine (cada segmento herda o `engine` da mensagem — ver multiSegment.ts).

import type { SynthRequest, TTSEngine } from './engine';

export class PerUserEngineRouter implements TTSEngine {
  constructor(
    private readonly google: TTSEngine,
    private readonly piper: TTSEngine,
    private readonly kokoro: TTSEngine,
  ) {}

  synth(req: SynthRequest): Promise<string> {
    if (req.engine === 'kokoro') return this.kokoro.synth(req);
    return (req.engine === 'piper' ? this.piper : this.google).synth(req);
  }
}
