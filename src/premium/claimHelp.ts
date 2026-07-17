// src/premium/claimHelp.ts
//
// The buyer asks us to activate a purchase by hand (plan 036 F3).
//
// WHY THIS IS NOT AN AUTOMATIC ACTIVATION, and cannot be: the Ko-fi email receipt prints
// `Ref: S-M1X823C9FW`, which is the only code-looking string in the whole email — but Ko-fi does
// NOT send that Ref in the webhook payload (see KofiEvent in ./kofi.ts). No pending row carries
// it, so nothing can ever match it. What the Ref CAN do is identify the order in the Ko-fi seller
// panel, where the owner reads the buyer's email, finds the transaction, and grants by hand.
// This module turns (Discord ID, Ref) into that notification and nothing more.
//
// The Discord identity arrives already validated by OAuth (the endpoint calls
// statusApi.resolveIdentity first), so `discordId` is trusted here. No IO beyond the webhook POST.

/** Personal data leaving this module: the Discord ID (the buyer just authenticated with it) and
 *  the Ref they typed. Deliberately NOT the email, the pass, or anything else we hold. */
export interface ClaimHelpDeps {
  /** Discord webhook to notify. EMPTY => inert (opt-in, same shape as the error reporter). */
  webhookUrl: string;
  fetchImpl: typeof fetch;
  logError: (m: string, err: unknown) => void;
}

/** Longest Ref we will repeat back. A real one is ~12 chars; this is slack, not a target. */
const MAX_REF = 40;
/** One person asking about the SAME purchase again inside this window is the same request. */
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Distinct (user, ref) pairs remembered before the map is cleared (unbounded growth guard). */
const DEDUPE_CAP = 1000;
/** A slow webhook must not hold an HTTP handler open. */
const WEBHOOK_TIMEOUT_MS = 5_000;

/**
 * Strips a buyer-typed Ref down to what is safe to put in a message we send. Everything that is
 * not alphanumeric or a dash goes: backticks and asterisks (markdown), '@' (mentions), '/' and ':'
 * (links), newlines (a fake second message). A real Ko-fi Ref is unaffected — it is
 * `S-` plus alphanumerics — so this only ever costs the attacker.
 */
export function sanitizeRef(raw: string): string {
  return raw
    .trim()
    .replace(/[^A-Za-z0-9-]/g, '')
    .slice(0, MAX_REF);
}

/**
 * True when this help request should actually be sent. Keyed by user+ref: pressing the button
 * five times must not page the owner five times, but the same person asking about a DIFFERENT
 * purchase is a genuine second request. After the window it passes again — the owner may simply
 * have missed the first one, and a buyer who paid should not be silenced by our bookkeeping.
 */
export function shouldSendClaimHelp(
  seen: Map<string, number>,
  discordId: string,
  ref: string,
  now: number,
): boolean {
  const key = `${discordId}:${ref}`;
  const last = seen.get(key);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return false;
  if (seen.size >= DEDUPE_CAP) seen.clear();
  seen.set(key, now);
  return true;
}

/** The message the owner reads. Written to still be actionable months later, when the context of
 *  why a Ref is not a code is long gone. */
export function buildClaimHelpMessage(discordId: string, ref: string): string {
  return [
    '🆘 **Activation help requested**',
    `Discord ID: \`${discordId}\``,
    `Ko-fi order Ref: \`${ref}\``,
    '',
    'The Ref is not something the bot can match (Ko-fi never sends it in the webhook).',
    'Find the order by this Ref in the Ko-fi seller panel, then activate it with',
    '`/premium grant` for that Discord ID.',
  ].join('\n');
}

/**
 * Sends the notification. Returns whether it went out — the caller decides what to tell the buyer.
 * NEVER throws: a failure to report must not take the endpoint down, and the site already has a
 * copy-this-to-support fallback for exactly this case.
 */
export async function sendClaimHelp(
  deps: ClaimHelpDeps,
  discordId: string,
  ref: string,
): Promise<boolean> {
  if (!deps.webhookUrl) return false;
  try {
    const res = await deps.fetchImpl(deps.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: buildClaimHelpMessage(discordId, ref),
        // Belt and braces with sanitizeRef: even if a mention survived, Discord must not ping.
        allowed_mentions: { parse: [] },
      }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!res.ok) {
      deps.logError(`[claim-help] webhook returned ${res.status}`, null);
      return false;
    }
    return true;
  } catch (err) {
    deps.logError('[claim-help] failed to notify', err);
    return false;
  }
}
