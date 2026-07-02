// Setup GLOBAL da suite de testes (vitest `setupFiles`).
//
// Força o caminho ONE-SHOT do Piper (`PIPER_PERSISTENT=0`) durante os testes. Em
// produção o pool persistente está ON por defeito (T2.1), mas os testes que mockam o
// `child_process.spawn` (piper.test.ts, piperConcurrency.test.ts) assumem o protocolo
// one-shot (close/error), não o do pool (linhas de stdout). O pool persistente é
// testado em ISOLAMENTO em piperPool.test.ts (injeta o spawn directamente), pelo que
// esta flag não o afecta. Fixar aqui evita que qualquer teste futuro caia no pool sem
// querer.
process.env.PIPER_PERSISTENT = '0';
