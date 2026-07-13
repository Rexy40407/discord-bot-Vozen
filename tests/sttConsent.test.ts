import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import {
  grantSttConsent,
  hasSttConsent,
  revokeSttConsent,
  getSttConsent,
} from '../src/store/sttConsent';

// Consentimento STT por-locutor, CONSENT-FIRST e por-SERVIDOR (1-clique lembrado): a linha
// só existe depois de a pessoa consentir; `consent_at` regista quando. hasSttConsent é o GATE
// que decide se um locutor entra no receiver de transcrição. Revogar = apagar a linha.

const U = '111';
const G = 'guildA';

describe('store/sttConsent', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('sem consentimento, o gate nega (consent-first)', () => {
    expect(hasSttConsent(db, U, G)).toBe(false);
    expect(getSttConsent(db, U, G)).toBeNull();
  });

  it('grant regista consent_at e o gate passa a permitir', () => {
    grantSttConsent(db, U, G, 1700);
    expect(hasSttConsent(db, U, G)).toBe(true);
    expect(getSttConsent(db, U, G)).toEqual({ userId: U, guildId: G, consentAt: 1700 });
  });

  it('o consentimento é POR-SERVIDOR (não vaza para outra guild)', () => {
    grantSttConsent(db, U, G, 1700);
    expect(hasSttConsent(db, U, 'guildB')).toBe(false);
  });

  it('grant repetido é idempotente e preserva o consent_at original (1-clique-na-vida)', () => {
    grantSttConsent(db, U, G, 1700);
    grantSttConsent(db, U, G, 9999);
    expect(getSttConsent(db, U, G)?.consentAt).toBe(1700);
  });

  it('revoke apaga a linha e o gate volta a negar; devolve true só quando havia consentimento', () => {
    grantSttConsent(db, U, G, 1700);
    expect(revokeSttConsent(db, U, G)).toBe(true);
    expect(hasSttConsent(db, U, G)).toBe(false);
    expect(revokeSttConsent(db, U, G)).toBe(false); // já não havia nada
  });
});
