// tests/claim.test.ts — claiming a pending Ko-fi purchase.
//
// The Ko-fi subscription checkout has no message box, and a GUEST buyer has no
// transaction history — but the EMAIL is not a secret (see plan 021: for anyone who knows it,
// it would be possible to steal someone else's Premium via any logged-in Discord account, during
// the 90-day retention of the pending grant). So the claim accepts ONLY the receipt's transaction
// CODE (a strong key only the buyer has); an input with '@' (email) is rejected with reason
// `use_receipt_code`, without even touching the DB. See src/premium/claim.ts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { recordPendingGrant, findUnclaimedPendingByTx } from '../src/store/kofiPending';
import { claimPendingGrant } from '../src/premium/claim';
import { hashKofiEmail } from '../src/premium/kofi';
import { isUserPremium, getPremiumPass, lookupKofiSupporter } from '../src/store/premium';

const DID = '123456789012345678';
const TOKEN = 'kofi-webhook-secret';
const EMAIL = 'buyer@example.com';
const EMAIL_HASH = hashKofiEmail(TOKEN, EMAIL);

describe('claimPendingGrant — claim a pending purchase (code only, plan 021)', () => {
  let db: Database.Database;
  const now = 1_000_000;
  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  const pend = (over: Partial<Parameters<typeof recordPendingGrant>[1]> = {}) => ({
    transactionId: 'tx-1',
    emailHash: EMAIL_HASH,
    plan: 'plus',
    days: 30,
    seats: 3,
    ...over,
  });

  // ── EMAIL (plan 021: no longer proof of ownership — rejected, without touching the DB) ─────────
  it('email-like input -> use_receipt_code (applies nothing, pending stays unclaimed)', () => {
    recordPendingGrant(db, pend(), now);
    const out = claimPendingGrant(db, DID, EMAIL, now + 10);
    expect(out).toEqual({ ok: false, reason: 'use_receipt_code' });
    expect(isUserPremium(db, DID, now + 20)).toBe(false);
    expect(findUnclaimedPendingByTx(db, 'tx-1')).not.toBeNull(); // still unclaimed
    expect(lookupKofiSupporter(db, EMAIL_HASH)).toBeNull(); // nothing memorized
  });

  it('normalized email (uppercase/spaces) -> use_receipt_code too', () => {
    recordPendingGrant(db, pend(), now);
    expect(claimPendingGrant(db, DID, '  BUYER@Example.COM ', now)).toEqual({
      ok: false,
      reason: 'use_receipt_code',
    });
  });

  it('unknown email -> use_receipt_code all the same (no oracle: never queries the DB)', () => {
    expect(claimPendingGrant(db, DID, 'stranger@x.com', now)).toEqual({
      ok: false,
      reason: 'use_receipt_code',
    });
  });

  // ── Secondary path: CODE (tx id) ──────────────────────────────────────────────────
  it('code (tx id) -> activates and matches by internal email (applies all for that email)', () => {
    recordPendingGrant(db, pend({ transactionId: 'tx-1' }), now);
    recordPendingGrant(db, pend({ transactionId: 'tx-2' }), now + 100);
    const out = claimPendingGrant(db, DID, 'tx-1', now + 200);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.items).toHaveLength(2); // tx-1 + tx-2 (same email)
    expect(findUnclaimedPendingByTx(db, 'tx-2')).toBeNull();
  });

  it('code for a Premium -> pass with the right seats, source kofi', () => {
    recordPendingGrant(
      db,
      pend({ transactionId: 'tx-p', plan: 'premium', days: 365, seats: 8 }),
      now,
    );
    const out = claimPendingGrant(db, DID, 'tx-p', now);
    expect(out.ok).toBe(true);
    const pass = getPremiumPass(db, DID)!;
    expect(pass.seats).toBe(8);
    expect(pass.source).toBe('kofi');
  });

  it('unknown code -> not_found', () => {
    const out = claimPendingGrant(db, DID, 'nao-existe', now);
    expect(out).toEqual({ ok: false, reason: 'not_found' });
  });

  it('pending without email (emailHash null), claimed by code -> only its own purchase', () => {
    recordPendingGrant(db, pend({ transactionId: 'tx-solo', emailHash: null }), now);
    recordPendingGrant(db, pend({ transactionId: 'tx-other', emailHash: null }), now);
    const out = claimPendingGrant(db, DID, 'tx-solo', now);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.items).toHaveLength(1);
    expect(findUnclaimedPendingByTx(db, 'tx-other')).not.toBeNull();
  });

  it('code memorizes email->Discord ID (future renewals resolve themselves)', () => {
    recordPendingGrant(db, pend(), now);
    claimPendingGrant(db, DID, 'tx-1', now);
    expect(lookupKofiSupporter(db, EMAIL_HASH)).toBe(DID);
  });

  it('2nd claim of the same code -> not_found (single use, never doubles the grant)', () => {
    recordPendingGrant(db, pend(), now);
    expect(claimPendingGrant(db, DID, 'tx-1', now).ok).toBe(true);
    expect(claimPendingGrant(db, DID, 'tx-1', now)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('empty input -> not_found', () => {
    expect(claimPendingGrant(db, DID, '   ', now)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });
});
