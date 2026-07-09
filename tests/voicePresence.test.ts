import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import {
  rememberVoicePresence,
  forgetVoicePresence,
  listVoicePresence,
} from '../src/store/voicePresence';
import { planRejoin, type ChannelState } from '../src/voice/rejoin';

describe('voice_presence — store (persistência 24/7)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });

  it('remember insere e list devolve', () => {
    rememberVoicePresence(db, 'G1', 'C1', 1000);
    expect(listVoicePresence(db)).toEqual([{ guildId: 'G1', channelId: 'C1', updatedAt: 1000 }]);
  });

  it('remember é upsert (mesma guild -> atualiza canal, não duplica)', () => {
    rememberVoicePresence(db, 'G1', 'C1', 1000);
    rememberVoicePresence(db, 'G1', 'C2', 2000);
    expect(listVoicePresence(db)).toEqual([{ guildId: 'G1', channelId: 'C2', updatedAt: 2000 }]);
  });

  it('forget apaga (idempotente)', () => {
    rememberVoicePresence(db, 'G1', 'C1', 1000);
    forgetVoicePresence(db, 'G1');
    expect(listVoicePresence(db)).toEqual([]);
    forgetVoicePresence(db, 'G1'); // 2.ª vez -> no-op
    expect(listVoicePresence(db)).toEqual([]);
  });

  it('guarda várias guilds independentes', () => {
    rememberVoicePresence(db, 'G1', 'C1', 1000);
    rememberVoicePresence(db, 'G2', 'C2', 1000);
    expect(
      listVoicePresence(db)
        .map((r) => r.guildId)
        .sort(),
    ).toEqual(['G1', 'G2']);
  });
});

describe('planRejoin — política pura do rejoin no arranque', () => {
  const rows = [
    { guildId: 'PREM-READY', channelId: 'c', updatedAt: 0 },
    { guildId: 'PREM-GONE', channelId: 'c', updatedAt: 0 },
    { guildId: 'PREM-NOPERMS', channelId: 'c', updatedAt: 0 },
    { guildId: 'FREE', channelId: 'c', updatedAt: 0 },
  ];
  const states: Record<string, ChannelState> = {
    'PREM-READY': 'ready',
    'PREM-GONE': 'gone',
    'PREM-NOPERMS': 'no-perms',
    FREE: 'ready', // irrelevante: será esquecida por não ser Premium
  };
  const plan = planRejoin(rows, {
    isPremium: (g) => g.startsWith('PREM'),
    channelState: (g) => states[g],
  });

  it('Premium + canal pronto -> repõe', () => {
    expect(plan.rejoin.map((r) => r.guildId)).toEqual(['PREM-READY']);
  });

  it('não-Premium -> esquece (rede de segurança)', () => {
    expect(plan.forget).toContain('FREE');
  });

  it('Premium + canal apagado -> esquece', () => {
    expect(plan.forget).toContain('PREM-GONE');
  });

  it('Premium + sem permissões -> nem repõe nem esquece (tenta no próximo arranque)', () => {
    expect(plan.rejoin.map((r) => r.guildId)).not.toContain('PREM-NOPERMS');
    expect(plan.forget).not.toContain('PREM-NOPERMS');
  });

  it('lista vazia -> plano vazio', () => {
    expect(planRejoin([], { isPremium: () => true, channelState: () => 'ready' })).toEqual({
      rejoin: [],
      forget: [],
    });
  });
});
