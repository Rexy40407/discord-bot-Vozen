import { describe, it, expect } from 'vitest';
import { raceStates } from '../src/voice/raceStates';

/** Espera N ms (para dar tempo à perdedora de rejeitar e ao Node de emitir o evento). */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('raceStates — Promise.race sem unhandledRejection da perdedora', () => {
  it('resolve com o vencedor; a perdedora a rejeitar DEPOIS não emite unhandledRejection', async () => {
    // Nota: o vitest FALHA o ficheiro de teste se houver um unhandledRejection não
    // tratado — por isso, se este helper regredisse para Promise.race puro, a
    // perdedora tardia rebentava o ficheiro. Passar já é meia prova; o listener
    // abaixo torna-a explícita.
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      seen.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const winner = Promise.resolve('ok');
      const loser = new Promise<string>((_, rej) =>
        setTimeout(() => rej(new Error('perdedora tardia')), 10),
      );
      await expect(raceStates([winner, loser])).resolves.toBe('ok');
      // Janela para a perdedora rejeitar e o Node processar a fila de rejeições.
      await sleep(50);
      expect(seen).toEqual([]); // era aqui que o bug aparecia
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('todas rejeitam -> rejeita com a primeira (semântica do race preservada)', async () => {
    const a = new Promise<string>((_, rej) => setTimeout(() => rej(new Error('a')), 5));
    const b = new Promise<string>((_, rej) => setTimeout(() => rej(new Error('b')), 15));
    await expect(raceStates([a, b])).rejects.toThrow('a');
    await sleep(30); // b rejeita depois — também não pode vazar
  });

  it('propaga o valor de resolução tal e qual', async () => {
    await expect(raceStates([Promise.resolve(42)])).resolves.toBe(42);
  });
});
