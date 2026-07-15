// src/store/voteReward.ts
//
// Reward for VOTING on top.gg (growth loop, GROWTH·1). An eligible upvote grants
// VOTE_REWARD_HOURS of Vozen Plus per-user (source 'vote' — EXTRA, never the base
// quality). The reward has a COOLDOWN of VOTE_REWARD_COOLDOWN_MS: each account only
// earns it 1× every 30 days, even though top.gg allows voting every 12h.
// Without this, 24h of reward + top.gg's 12h cooldown would make Plus ACCUMULATE
// without a cap (voting for 1 month ≈ banking ~1 year of free Plus), cannibalizing
// paid Plus.
//
// The vote_reward table stores only { user_id, rewarded_at } — the instant of the
// last Plus earned by voting, to measure the cooldown. It is minimal personal data,
// erasable via /privacy erase (see dataLifecycle USER_ERASE_TABLES + PRIVACY.md).
import type Database from 'better-sqlite3';
import { grantUserPremium } from './premium';

/** Duration of the reward for an eligible vote: these hours of Plus per-user. */
export const VOTE_REWARD_HOURS = 24;
/** Cooldown of the REWARD (not the vote): the same account only earns Plus 1× per month. */
export const VOTE_REWARD_COOLDOWN_MS = 30 * 86_400_000;

export interface VoteRewardResult {
  /** true if Plus was granted now; false if it was in cooldown. */
  granted: boolean;
  /** New Plus expiry (ms) — present when granted=true. */
  expiresAt?: number;
  /** When the cooldown ends (ms) — present when granted=false. */
  nextEligibleAt?: number;
}

/** Instant of the last Plus earned by voting (ms), or null if never earned. */
export function getVoteRewardAt(db: Database.Database, userId: string): number | null {
  const row = db.prepare('SELECT rewarded_at FROM vote_reward WHERE user_id = ?').get(userId) as
    { rewarded_at: number } | undefined;
  return row ? row.rewarded_at : null;
}

/**
 * Attempts to grant the vote reward to `userId`. Transactional (reads the cooldown,
 * grants and records atomically) so that two near-simultaneous top.gg webhooks don't
 * give two rewards. If still within the cooldown, grants NOTHING (the vote itself
 * already counted in the metric, separately). Returns the result for the caller to
 * log. Idempotent in practice: a retry within the cooldown returns granted=false.
 */
export function claimVoteReward(
  db: Database.Database,
  userId: string,
  now: number,
): VoteRewardResult {
  const tx = db.transaction((): VoteRewardResult => {
    const last = getVoteRewardAt(db, userId);
    if (last !== null && now - last < VOTE_REWARD_COOLDOWN_MS) {
      return { granted: false, nextEligibleAt: last + VOTE_REWARD_COOLDOWN_MS };
    }
    const expiresAt = grantUserPremium(db, userId, VOTE_REWARD_HOURS / 24, 'vote', now);
    db.prepare(
      `INSERT INTO vote_reward (user_id, rewarded_at) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET rewarded_at = excluded.rewarded_at`,
    ).run(userId, now);
    return { granted: true, expiresAt };
  });
  return tx();
}

export interface VoteRewardStatus {
  /** Can the vote reward be earned right now? */
  eligible: boolean;
  /** If in cooldown, when it becomes eligible again (ms); otherwise null. */
  nextEligibleAt: number | null;
}

/** Vote reward state for DISPLAY (/vote, /premium). Read-only. */
export function voteRewardStatus(
  db: Database.Database,
  userId: string,
  now: number,
): VoteRewardStatus {
  const last = getVoteRewardAt(db, userId);
  if (last === null || now - last >= VOTE_REWARD_COOLDOWN_MS) {
    return { eligible: true, nextEligibleAt: null };
  }
  return { eligible: false, nextEligibleAt: last + VOTE_REWARD_COOLDOWN_MS };
}
