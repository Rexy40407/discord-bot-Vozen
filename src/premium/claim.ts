// src/premium/claim.ts
//
// PURE logic of the CLAIM: the buyer claims a pending Ko-fi purchase (that arrived without a
// Discord ID, see store/kofiPending.ts) by entering the transaction CODE from the receipt — a
// strong key that only they have. The Discord identity comes already validated by OAuth (the
// endpoint calls statusApi.resolveIdentity BEFORE this), so here we trust the `discordId`. Applies
// the grant, marks the pending one claimed and memorizes email->Discord ID (future renewals
// resolve themselves). No network IO; testable in isolation.

import type Database from 'better-sqlite3';
import { grantUserPremium, grantGuildPass, rememberKofiSupporter } from '../store/premium';
import {
  findUnclaimedPendingByTx,
  listUnclaimedPendingByEmailHash,
  markPendingClaimed,
  type PendingGrant,
} from '../store/kofiPending';

/** A purchase applied in the claim (for the response to the site). */
export interface ClaimedItem {
  plan: string; // 'plus' | 'premium'
  days: number;
  seats: number;
  expiresAt: number;
}

export type ClaimOutcome =
  | { ok: true; items: ClaimedItem[] }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'use_receipt_code' };

/** Applies ONE pending grant to the Discord ID (per-user Plus or Premium pass). source='kofi'. */
function applyPending(
  db: Database.Database,
  discordId: string,
  p: PendingGrant,
  now: number,
): ClaimedItem {
  const expiresAt =
    p.plan === 'plus'
      ? grantUserPremium(db, discordId, p.days, 'kofi', now)
      : grantGuildPass(db, discordId, p.seats, p.days, 'kofi', now);
  return { plan: p.plan, days: p.days, seats: p.seats, expiresAt };
}

/**
 * Claims a pending Ko-fi purchase. The `input` must be the transaction CODE from the Ko-fi receipt
 * (a strong key that only the buyer has). An `input` of the EMAIL type (contains '@') is REJECTED with
 * `use_receipt_code` without touching the DB — the email is NOT accepted as proof of ownership: it is not a secret,
 * and any logged-in Discord account that knew it could claim someone else's Premium
 * during the pending grant's 90-day retention (see "## Decision" in plan 021). The
 * Discord identity comes already validated by OAuth. Applies to the `discordId` ALL the pending
 * purchases of the SAME email (orphan renewals), marks them claimed and memorizes email->Discord ID
 * (future renewals resolve automatically). The operation is transactional and single-use.
 */
export function claimPendingGrant(
  db: Database.Database,
  discordId: string,
  input: string,
  now: number,
): ClaimOutcome {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: 'not_found' };
  const tx = db.transaction((): ClaimOutcome => {
    let targets: PendingGrant[];
    let emailHashForRemember: string | null;

    if (trimmed.includes('@')) {
      // Via EMAIL: plan 021 — no longer accepted as proof of ownership (not a secret). Returns
      // use_receipt_code WITHOUT touching the DB: the response does not vary depending on whether the
      // email belongs to a pending purchase or not, so there is no oracle to exploit here.
      return { ok: false, reason: 'use_receipt_code' };
    } else {
      // Via CODE (tx id): find the pending grant and, through it, all purchases of the same email.
      const match = findUnclaimedPendingByTx(db, trimmed);
      if (!match) return { ok: false, reason: 'not_found' };
      targets = match.emailHash ? listUnclaimedPendingByEmailHash(db, match.emailHash) : [match];
      emailHashForRemember = match.emailHash;
    }

    const items: ClaimedItem[] = [];
    for (const p of targets) {
      // markPendingClaimed returns false if it was already claimed (race) — in that case we don't
      // apply it, to never grant double days.
      if (!markPendingClaimed(db, p.transactionId, now)) continue;
      items.push(applyPending(db, discordId, p, now));
    }
    if (items.length === 0) return { ok: false, reason: 'not_found' };
    if (emailHashForRemember) rememberKofiSupporter(db, emailHashForRemember, discordId, now);
    return { ok: true, items };
  });
  return tx();
}
