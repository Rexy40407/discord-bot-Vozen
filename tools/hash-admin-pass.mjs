// tools/hash-admin-pass.mjs
//
// Generates an ADMIN_PASS_HASH for the Vozen admin console (plan 037). Reads the password from
// STDIN (so the plaintext never lands in shell history) and prints `<saltHex>:<hashHex>` (scrypt,
// 16-byte salt, 32-byte key) — exactly the format src/premium/adminAuth.ts verifies.
//
// Usage:
//   printf '%s' 'your-strong-password' | node tools/hash-admin-pass.mjs
// Then paste the line into the VPS .env as:  ADMIN_PASS_HASH=<output>
import { randomBytes, scryptSync } from 'node:crypto';

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const password = Buffer.concat(chunks)
  .toString('utf8')
  .replace(/\r?\n$/, '');

if (!password) {
  console.error("No password on stdin. Usage: printf '%s' 'pass' | node tools/hash-admin-pass.mjs");
  process.exit(1);
}

const salt = randomBytes(16);
const derived = scryptSync(password, salt, 32);
console.log(`${salt.toString('hex')}:${derived.toString('hex')}`);
