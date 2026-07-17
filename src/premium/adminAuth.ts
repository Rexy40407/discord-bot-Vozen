// src/premium/adminAuth.ts
//
// Auth for the Vozen admin console (plan 037). The console hands out real Premium/Plus and reads
// every server's stats, and both the page and this code live in PUBLIC repos — so the auth IS the
// whole security boundary. Three independent proofs, ALL required, enforced by the router:
//   1. a shared username+password (scrypt hash in env — never plaintext, never in the repo),
//   2. a Discord OAuth token whose identity == the configured owner id,
//   3. on every later request, a signed session minted only after 1+2 both passed.
// This module is the pure crypto half — password verification and session sign/verify. The HTTP
// wiring, the Discord identity check and the rate-limit live in the router (kofiWebhook.ts). Kept
// pure so these security-critical comparisons are unit-tested in isolation.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** scrypt derived-key length (bytes). Fixed so a stored hash of the wrong length is rejected. */
const SCRYPT_KEYLEN = 32;
/** Default session lifetime — mirrors the Vozen-helper panel (8h). */
const DEFAULT_TTL_SEC = 8 * 3600;

/**
 * Builds an `ADMIN_PASS_HASH` value from a plaintext password: `<saltHex>:<derivedHex>` (scrypt).
 * Used by tools/hash-admin-pass.mjs. `salt` is injectable for deterministic tests; in production a
 * fresh 16-byte random salt is used. The plaintext is never stored or returned.
 */
export function hashAdminPassword(password: string, salt?: Buffer): string {
  const s = salt ?? randomBytes(16);
  const derived = scryptSync(password, s, SCRYPT_KEYLEN);
  return `${s.toString('hex')}:${derived.toString('hex')}`;
}

/** Timing-safe string equality. Length mismatch => false, but still runs a compare so the early
 *  return does not leak a length via timing. */
function safeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab); // constant-ish work; result ignored
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/**
 * True iff `providedUser`+`providedPass` match the configured admin credentials. Returns a SINGLE
 * boolean on purpose: the caller must not be able to tell WHICH half failed (username vs password).
 * Never throws — a malformed/empty `passHash` simply yields false (the console stays locked).
 */
export function verifyAdminPassword(
  providedUser: string,
  providedPass: string,
  expectedUser: string,
  passHash: string,
): boolean {
  const userOk = safeEqualStr(providedUser, expectedUser);
  let passOk = false;
  const parts = passHash.split(':');
  if (parts.length === 2 && parts[0] && parts[1]) {
    try {
      const salt = Buffer.from(parts[0], 'hex');
      const expected = Buffer.from(parts[1], 'hex');
      if (salt.length > 0 && expected.length === SCRYPT_KEYLEN) {
        const derived = scryptSync(providedPass, salt, SCRYPT_KEYLEN);
        passOk = timingSafeEqual(derived, expected);
      }
    } catch {
      passOk = false;
    }
  }
  // Evaluate both halves before returning (no `&&` short-circuit on userOk) so a wrong username
  // doesn't skip the scrypt work and become distinguishable by timing.
  return userOk && passOk;
}

/**
 * Signs an admin session token `<userId>.<expEpochSec>.<sigBase64url>` (HMAC-SHA256 over
 * `<userId>.<exp>`). Same shape as the Vozen-helper panel session, so the pattern is identical
 * across the two consoles. Minted ONLY after the full password+OAuth+owner check.
 */
export function signAdminSession(
  userId: string,
  secret: string,
  now: number,
  ttlSec: number = DEFAULT_TTL_SEC,
): string {
  const exp = Math.floor(now / 1000) + ttlSec;
  const payload = `${userId}.${exp}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/**
 * Returns the `userId` iff the token is well-formed, unexpired, and correctly signed; else null.
 * The caller still re-checks `userId === ownerId` (defense in depth) before acting.
 */
export function verifyAdminSession(token: string, secret: string, now: number): string | null {
  const parts = (token ?? '').split('.');
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  const payload = `${userId}.${expStr}`;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const exp = Number.parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp * 1000 < now) return null;
  return userId;
}
