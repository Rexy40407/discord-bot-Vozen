// src/tts/router.ts
//
// RouterEngine — combina VÁRIOS motores TTS num só, escolhendo por-língua e caindo
// no seguinte quando um falha. Cada `synth(req)` olha para a língua do `req.model`
// (prefixo, ex. 'pt') e tenta, POR ORDEM DE PRIORIDADE, os motores que suportam essa
// língua; se um lança (ex.: gTTS com HTTP 429 da Google), tenta o próximo. Assim:
//   - QUALIDADE: usa o melhor motor disponível para cada língua (ex. Kokoro no topo).
//   - FIABILIDADE: um motor em baixo cai automaticamente no seguinte (ex. gTTS -> Piper).
//   - COBERTURA: um motor "apanha-tudo" (langs=null) no fim garante que NENHUMA língua
//     fica sem voz (ex. Piper, local, cobre as 34).
//
// Encaixa como motor BASE (mesmo contrato TTSEngine), por baixo do MultiSegmentEngine:
// numa mensagem multi-língua, cada segmento é roteado para o motor certo da sua língua.

import type { SynthRequest, TTSEngine } from './engine';
import { langKeyOfModel } from '../language/spokenPhrases';
import { log } from '../logging/logger';

export interface EngineRoute {
  engine: TTSEngine;
  /**
   * Prefixos de locale suportados (ex. new Set(['en','pt','es'])). `null` = motor
   * APANHA-TUDO (suporta qualquer língua) — obrigatório no fim da lista.
   */
  langs: Set<string> | null;
  /** Nome curto para logs (ex. 'kokoro', 'gtts', 'piper'). */
  label: string;
}

export class RouterEngine implements TTSEngine {
  constructor(private readonly routes: EngineRoute[]) {
    if (routes.length === 0) {
      throw new Error('[router] pelo menos um motor é obrigatório');
    }
    // Invariante de COBERTURA: o último motor tem de ser apanha-tudo (langs=null),
    // senão uma língua sem rota específica cairia num throw. Barato de garantir aqui.
    if (routes[routes.length - 1].langs !== null) {
      throw new Error(
        '[router] o último motor tem de ser apanha-tudo (langs=null) — cobertura total',
      );
    }
  }

  async synth(req: SynthRequest): Promise<string> {
    const key = langKeyOfModel(req.model);
    // Candidatos: motores que suportam esta língua, na ordem de prioridade dada.
    const candidates = this.routes.filter((r) => r.langs === null || r.langs.has(key));
    let lastErr: unknown;
    for (let idx = 0; idx < candidates.length; idx++) {
      const route = candidates[idx];
      try {
        return await route.engine.synth(req);
      } catch (err) {
        lastErr = err;
        const next = candidates[idx + 1];
        log.warn(
          `[router] motor '${route.label}' falhou para '${key}'` +
            (next ? ` — a cair para '${next.label}'` : ' — sem mais alternativas') +
            `: ${(err as Error).message}`,
        );
      }
    }
    // Só chega aqui se TODOS os candidatos falharam (o apanha-tudo incluído).
    throw lastErr ?? new Error(`[router] sem motor para a língua '${key}'`);
  }
}
