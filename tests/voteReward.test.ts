import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDb } from '../src/store/db';
import { isUserPremium, getUserPremiumExpiry } from '../src/store/premium';
import {
  claimVoteReward,
  voteRewardStatus,
  getVoteRewardAt,
  VOTE_REWARD_HOURS,
  VOTE_REWARD_COOLDOWN_MS,
} from '../src/store/voteReward';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const U = 'voter-1';

describe('voteReward — 24h reward with a 30-day cooldown', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });
  afterEach(() => db.close());

  it('constants: reward = 24h, cooldown = 30 days', () => {
    // Pin the literals (Diogo chose 24h + 1 month). Do NOT derive from the constant on
    // both sides — otherwise the test is tautological and doesn't protect the value.
    expect(VOTE_REWARD_HOURS).toBe(24);
    expect(VOTE_REWARD_COOLDOWN_MS).toBe(30 * DAY_MS);
  });

  it('1st vote: grants 24h of Plus and records the moment', () => {
    const NOW = 1_000_000_000;
    const res = claimVoteReward(db, U, NOW);
    expect(res.granted).toBe(true);
    expect(res.expiresAt).toBe(NOW + 24 * HOUR_MS);
    expect(isUserPremium(db, U, NOW + 1000)).toBe(true);
    expect(isUserPremium(db, U, NOW + 24 * HOUR_MS + 1)).toBe(false);
    expect(getVoteRewardAt(db, U)).toBe(NOW);
  });

  it('2nd vote within the 30 days: grants NOTHING (cooldown) and does not extend the Plus', () => {
    const NOW = 1_000_000_000;
    claimVoteReward(db, U, NOW);
    const expiryDepoisDo1 = getUserPremiumExpiry(db, U);

    // 12h later (can vote on top.gg, but the reward is in cooldown).
    const res2 = claimVoteReward(db, U, NOW + 12 * HOUR_MS);
    expect(res2.granted).toBe(false);
    expect(res2.nextEligibleAt).toBe(NOW + VOTE_REWARD_COOLDOWN_MS);
    // The Plus did NOT accumulate — it still expires at the same instant as the 1st vote.
    expect(getUserPremiumExpiry(db, U)).toBe(expiryDepoisDo1);
    // The cooldown marker also didn't move backward or forward.
    expect(getVoteRewardAt(db, U)).toBe(NOW);
  });

  it('vote exactly at 30 days: eligible again, grants a new 24h', () => {
    const NOW = 1_000_000_000;
    claimVoteReward(db, U, NOW);
    const LATER = NOW + VOTE_REWARD_COOLDOWN_MS; // boundary: already eligible
    const res = claimVoteReward(db, U, LATER);
    expect(res.granted).toBe(true);
    expect(res.expiresAt).toBe(LATER + 24 * HOUR_MS);
    expect(getVoteRewardAt(db, U)).toBe(LATER);
  });

  it('voteRewardStatus: eligible when never earned; in cooldown it shows the next instant', () => {
    const NOW = 1_000_000_000;
    expect(voteRewardStatus(db, U, NOW)).toEqual({ eligible: true, nextEligibleAt: null });

    claimVoteReward(db, U, NOW);
    expect(voteRewardStatus(db, U, NOW + DAY_MS)).toEqual({
      eligible: false,
      nextEligibleAt: NOW + VOTE_REWARD_COOLDOWN_MS,
    });
    expect(voteRewardStatus(db, U, NOW + VOTE_REWARD_COOLDOWN_MS)).toEqual({
      eligible: true,
      nextEligibleAt: null,
    });
  });

  it('user with no history: getVoteRewardAt returns null', () => {
    expect(getVoteRewardAt(db, 'ninguem')).toBeNull();
  });
});
