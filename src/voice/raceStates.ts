// src/voice/raceStates.ts
//
// Promise.race "arrumado": o Promise.race nativo fica resolvido com a PRIMEIRA
// promessa a assentar, mas as PERDEDORAS continuam vivas — quando uma perdedora
// rejeita mais tarde (ex.: o timeout do entersState perdedor a disparar), ninguém
// tem handler nela e o Node emite unhandledRejection. No Vozen isso ia parar ao
// webhook de erros (src/bot/client.ts) como um falso alarme em CADA recuperação
// soft falhada. Este helper anexa um catch no-op a cada concorrente (marca a
// rejeição como tratada) e devolve o race normal — semântica idêntica:
// resolve/rejeita com a primeira a assentar.

export function raceStates<T>(promises: readonly Promise<T>[]): Promise<T> {
  for (const p of promises) {
    // no-op: só marca a promessa como "handled"; não altera o resultado do race
    p.catch(() => {});
  }
  return Promise.race(promises);
}
