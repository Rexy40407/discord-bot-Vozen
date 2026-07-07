import { describe, it, expect, vi } from 'vitest';
import type { Client } from 'discord.js';
import { createGameThread, deleteChannelSafe } from '../src/games/thread';

// Silenciar o logger nos testes (as mensagens de warn/info fazem parte do contrato
// de observabilidade, mas aqui só afirmamos o COMPORTAMENTO: apagar → arquivar → nada).
vi.mock('../src/logging/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/** Client falso: só o que o deleteChannelSafe usa (cache.get + fetch). */
function makeClient(channel: unknown): Client {
  return {
    channels: {
      cache: new Map(channel ? [['thread-1', channel]] : []),
      fetch: async () => null,
    },
  } as unknown as Client;
}

describe('deleteChannelSafe — escada apagar → arquivar → nada', () => {
  it('apaga a thread quando tem permissão (não arquiva)', async () => {
    const del = vi.fn(async () => ({}));
    const setArchived = vi.fn(async () => ({}));
    await deleteChannelSafe(makeClient({ delete: del, setArchived }), 'thread-1');
    expect(del).toHaveBeenCalledOnce();
    expect(setArchived).not.toHaveBeenCalled();
  });

  it('sem Manage Threads (delete rejeita) → ARQUIVA a thread como fallback', async () => {
    const del = vi.fn(async () => {
      throw new Error('Missing Permissions');
    });
    const setArchived = vi.fn(async () => ({}));
    await deleteChannelSafe(makeClient({ delete: del, setArchived }), 'thread-1');
    expect(del).toHaveBeenCalledOnce();
    expect(setArchived).toHaveBeenCalledWith(true, expect.any(String));
  });

  it('apagar E arquivar falham → não lança (auto-arquivo é a última rede)', async () => {
    const del = vi.fn(async () => {
      throw new Error('Missing Permissions');
    });
    const setArchived = vi.fn(async () => {
      throw new Error('Missing Permissions');
    });
    await expect(
      deleteChannelSafe(makeClient({ delete: del, setArchived }), 'thread-1'),
    ).resolves.toBeUndefined();
  });

  it('thread já não existe → no-op sem lançar', async () => {
    await expect(deleteChannelSafe(makeClient(null), 'thread-1')).resolves.toBeUndefined();
  });
});

describe('createGameThread — fallback silencioso', () => {
  it('canal sem suporte de threads (ex.: voz) → null', async () => {
    expect(await createGameThread({ type: 2 }, 'jogo')).toBeNull();
  });

  it('threads.create rejeita (sem permissão) → null, sem lançar', async () => {
    const channel = {
      type: 0, // GuildText
      threads: {
        create: async () => {
          throw new Error('Missing Permissions');
        },
      },
    };
    expect(await createGameThread(channel, 'jogo')).toBeNull();
  });

  it('caminho feliz → devolve o id da thread', async () => {
    const channel = {
      type: 0,
      threads: { create: async () => ({ id: 'nova-thread' }) },
    };
    expect(await createGameThread(channel, '🎮 Wordle')).toBe('nova-thread');
  });
});
