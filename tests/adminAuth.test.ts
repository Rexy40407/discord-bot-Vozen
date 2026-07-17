import { createHmac, scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  hashAdminPassword,
  signAdminSession,
  verifyAdminPassword,
  verifyAdminSession,
} from '../src/premium/adminAuth';

// The admin console (plan 037) hands out real Premium/Plus and reads every server's stats, so its
// auth is the whole security boundary — the page and code are public (two public repos). These
// tests pin the pure crypto half: password verification and the signed session. The HTTP wiring,
// the Discord-identity check and the rate-limit live in the router and are tested there.

const SECRET = 'admin-session-secret-abc';

describe('adminAuth — password', () => {
  it('hashAdminPassword round-trips with verifyAdminPassword', () => {
    const hash = hashAdminPassword('correct horse battery');
    expect(hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/); // saltHex:hashHex
    expect(verifyAdminPassword('owner', 'correct horse battery', 'owner', hash)).toBe(true);
  });

  it('is deterministic for a fixed salt (so the tool can print a stable hash)', () => {
    const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const a = hashAdminPassword('pw', salt);
    const b = hashAdminPassword('pw', salt);
    expect(a).toBe(b);
    expect(a.startsWith('00112233445566778899aabbccddeeff:')).toBe(true);
  });

  it('rejects a wrong password', () => {
    const hash = hashAdminPassword('right');
    expect(verifyAdminPassword('owner', 'wrong', 'owner', hash)).toBe(false);
  });

  it('rejects a wrong username even with the right password', () => {
    const hash = hashAdminPassword('right');
    expect(verifyAdminPassword('intruder', 'right', 'owner', hash)).toBe(false);
  });

  it('rejects when BOTH are wrong', () => {
    const hash = hashAdminPassword('right');
    expect(verifyAdminPassword('intruder', 'wrong', 'owner', hash)).toBe(false);
  });

  it('never throws on a malformed hash — returns false', () => {
    expect(verifyAdminPassword('owner', 'x', 'owner', 'not-a-valid-hash')).toBe(false);
    expect(verifyAdminPassword('owner', 'x', 'owner', '')).toBe(false);
    expect(verifyAdminPassword('owner', 'x', 'owner', 'aa:bb:cc')).toBe(false);
    // A hash whose second half is not the right key length must not pass.
    expect(verifyAdminPassword('owner', 'x', 'owner', 'aabb:ccdd')).toBe(false);
  });

  it('actually uses scrypt (a matching hand-built hash verifies)', () => {
    const salt = Buffer.from('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', 'hex');
    const derived = scryptSync('hunter2', salt, 32).toString('hex');
    const hash = `${salt.toString('hex')}:${derived}`;
    expect(verifyAdminPassword('owner', 'hunter2', 'owner', hash)).toBe(true);
    expect(verifyAdminPassword('owner', 'hunter3', 'owner', hash)).toBe(false);
  });
});

describe('adminAuth — session', () => {
  const NOW = 1_700_000_000_000; // fixed ms

  it('signs and verifies a session, returning the userId', () => {
    const tok = signAdminSession('1523489275155583056', SECRET, NOW);
    expect(verifyAdminSession(tok, SECRET, NOW)).toBe('1523489275155583056');
  });

  it('rejects an expired session', () => {
    const tok = signAdminSession('1523489275155583056', SECRET, NOW, 3600);
    // 1 second after expiry
    expect(verifyAdminSession(tok, SECRET, NOW + 3601_000)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const tok = signAdminSession('1523489275155583056', 'other-secret', NOW);
    expect(verifyAdminSession(tok, SECRET, NOW)).toBeNull();
  });

  it('rejects a tampered userId (signature no longer matches)', () => {
    const tok = signAdminSession('1523489275155583056', SECRET, NOW);
    const forged = tok.replace('1523489275155583056', '999999999999999999');
    expect(verifyAdminSession(forged, SECRET, NOW)).toBeNull();
  });

  it('rejects a tampered expiry', () => {
    const tok = signAdminSession('1523489275155583056', SECRET, NOW, 3600);
    const [uid, exp, sig] = tok.split('.');
    const bumped = `${uid}.${Number(exp) + 999999}.${sig}`;
    expect(verifyAdminSession(bumped, SECRET, NOW)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyAdminSession('', SECRET, NOW)).toBeNull();
    expect(verifyAdminSession('a.b', SECRET, NOW)).toBeNull();
    expect(verifyAdminSession('a.b.c.d', SECRET, NOW)).toBeNull();
  });

  it('uses HMAC-SHA256 over "<userId>.<exp>" (interop with the Vozen-helper format)', () => {
    const tok = signAdminSession('42', SECRET, NOW, 3600);
    const [uid, exp, sig] = tok.split('.');
    const expected = createHmac('sha256', SECRET).update(`${uid}.${exp}`).digest('base64url');
    expect(sig).toBe(expected);
  });
});
