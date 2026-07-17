// tests/claimHelp.test.ts — the buyer asks us to activate a purchase by hand (plan 036 F3).
//
// Why this exists at all: the Ko-fi email receipt prints `Ref: S-M1X823C9FW`, and that Ref is
// NEVER in the webhook payload (see KofiEvent in src/premium/kofi.ts) — so no pending row carries
// it and no code path can ever match it. The Ref cannot activate anything. What it CAN do is
// identify the order in the Ko-fi seller panel, so the owner can grant by hand. This module turns
// (Discord ID, Ref) into that notification.
import { describe, it, expect, vi } from 'vitest';
import {
  buildClaimHelpMessage,
  sanitizeRef,
  sendClaimHelp,
  shouldSendClaimHelp,
} from '../src/premium/claimHelp';

const DID = '123456789012345678';

describe('sanitizeRef — what may reach a Discord webhook', () => {
  // The Ref goes into a Discord message we send ourselves. Anything the buyer types is hostile
  // input until proven otherwise: markdown, mentions, links, newlines that fake a second message.
  it('keeps a real Ko-fi Ref intact', () => {
    expect(sanitizeRef('S-M1X823C9FW')).toBe('S-M1X823C9FW');
  });

  it('strips everything that is not alphanumeric or a dash', () => {
    expect(sanitizeRef('S-ABC `@everyone` **x**')).toBe('S-ABCeveryonex');
    expect(sanitizeRef('S-ABC\n\n@here')).toBe('S-ABChere');
    expect(sanitizeRef('S-ABC https://evil.example/x')).toBe('S-ABChttpsevilexamplex');
  });

  it('caps the length (a wall of text is not a Ref)', () => {
    expect(sanitizeRef('S-' + 'A'.repeat(200))).toHaveLength(40);
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeRef('  S-M1X823C9FW  ')).toBe('S-M1X823C9FW');
  });
});

describe('shouldSendClaimHelp — dedupe', () => {
  // One person pressing the button five times must not page the owner five times. Keyed by
  // user+ref: the same person asking about a DIFFERENT purchase is a real second request.
  it('lets the first request through and swallows the repeat', () => {
    const seen = new Map<string, number>();
    const now = 1_000_000;
    expect(shouldSendClaimHelp(seen, DID, 'S-A', now)).toBe(true);
    expect(shouldSendClaimHelp(seen, DID, 'S-A', now + 1000)).toBe(false);
  });

  it('treats a different Ref from the same person as a new request', () => {
    const seen = new Map<string, number>();
    expect(shouldSendClaimHelp(seen, DID, 'S-A', 1000)).toBe(true);
    expect(shouldSendClaimHelp(seen, DID, 'S-B', 1000)).toBe(true);
  });

  it('lets the same request through again after the window', () => {
    const seen = new Map<string, number>();
    expect(shouldSendClaimHelp(seen, DID, 'S-A', 0)).toBe(true);
    // A day later the owner may simply have missed it; asking again is legitimate.
    expect(shouldSendClaimHelp(seen, DID, 'S-A', 25 * 60 * 60 * 1000)).toBe(true);
  });

  it('does not grow without bound', () => {
    const seen = new Map<string, number>();
    for (let i = 0; i < 1200; i++) shouldSendClaimHelp(seen, `u${i}`, 'S-A', i);
    expect(seen.size).toBeLessThanOrEqual(1000);
  });
});

describe('buildClaimHelpMessage', () => {
  it('carries the Discord ID and the Ref, and nothing else about the buyer', () => {
    const msg = buildClaimHelpMessage(DID, 'S-M1X823C9FW');
    expect(msg).toContain(DID);
    expect(msg).toContain('S-M1X823C9FW');
    // The owner has to find the order in Ko-fi and grant — say so, so the message is actionable
    // months from now when the context is gone.
    expect(msg).toContain('/premium grant');
  });

  it('does not let a crafted Ref break out of the message', () => {
    const msg = buildClaimHelpMessage(DID, sanitizeRef('@everyone'));
    expect(msg).not.toContain('@everyone');
  });
});

describe('sendClaimHelp — the notification itself', () => {
  const deps = (fetchImpl: typeof fetch) => ({
    webhookUrl: 'https://discord.com/api/webhooks/1/abc',
    fetchImpl,
    logError: vi.fn(),
  });

  it('POSTs the message to the webhook', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body) });
      // `null`, not '': the Response constructor throws on a body with a 204 (null-body status),
      // and a throwing test double would look exactly like the code failing.
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const ok = await sendClaimHelp(deps(fake), DID, 'S-M1X823C9FW');
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://discord.com/api/webhooks/1/abc');
    expect(JSON.parse(calls[0].body).content).toContain('S-M1X823C9FW');
    // Never let the bot ping a whole server because a Ref happened to contain text.
    expect(JSON.parse(calls[0].body).allowed_mentions).toEqual({ parse: [] });
  });

  it('reports failure instead of throwing when the webhook is down', async () => {
    const boom = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const d = deps(boom);
    await expect(sendClaimHelp(d, DID, 'S-A')).resolves.toBe(false);
    expect(d.logError).toHaveBeenCalled();
  });

  it('reports failure on a non-2xx response', async () => {
    const fail = vi.fn(
      async () => new Response('nope', { status: 500 }),
    ) as unknown as typeof fetch;
    expect(await sendClaimHelp(deps(fail), DID, 'S-A')).toBe(false);
  });

  it('is inert without a webhook URL (opt-in, like the error reporter)', async () => {
    const fake = vi.fn() as unknown as typeof fetch;
    expect(
      await sendClaimHelp({ webhookUrl: '', fetchImpl: fake, logError: vi.fn() }, DID, 'S-A'),
    ).toBe(false);
    expect(fake).not.toHaveBeenCalled();
  });
});
