import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), { encoding: 'utf8' });

describe('operational security configuration', () => {
  it('keeps the Cloudflare CSP aligned with the self-hosted-font privacy promise', () => {
    const script = source('tools/cf-security-headers.mjs');
    expect(script).not.toContain('fonts.googleapis.com');
    expect(script).not.toContain('fonts.gstatic.com');
    expect(script).toContain("style-src 'self' 'unsafe-inline'");
    expect(script).toContain("font-src 'self'");
  });

  it('verifies both downloaded Kokoro model assets against pinned SHA-256 hashes', () => {
    const script = source('tools/setup-kokoro.ps1');
    expect(script).toContain('7D5DF8ECF7D4B1878015A32686053FD0EEBE2BC377234608764CC0EF3636A6C5');
    expect(script).toContain('BCA610B8308E8D99F32E6FE4197E7EC01679264EFED0CAC9140FE9C29F1FBF7D');
    expect(script).toContain('Get-FileHash');
  });

  it('handles a one-element Python command safely in the clone setup script', () => {
    const script = source('tools/setup-clone.ps1');
    expect(script).toContain('if ($basePy.Count -gt 1)');
    expect(script).not.toContain('& $basePy[0] $basePy[1..($basePy.Count-1)]');
  });

  it('does not ship byte-identical font files under duplicate names', () => {
    const fontDir = resolve(process.cwd(), 'site/assets/fonts');
    const byHash = new Map<string, string>();
    for (const name of readdirSync(fontDir)) {
      const bytes = readFileSync(resolve(fontDir, name));
      const hash = createHash('sha256').update(bytes).digest('hex');
      expect(byHash.get(hash), `${name} duplicates ${byHash.get(hash)}`).toBeUndefined();
      byHash.set(hash, name);
    }
  });

  it('keeps every font URL in the site stylesheet resolvable', () => {
    const css = source('site/css/main-v33.css');
    const urls = [...css.matchAll(/url\("\.\.\/assets\/fonts\/([^"?]+)"\)/g)].map(
      (match) => match[1],
    );
    expect(urls.length).toBeGreaterThan(0);
    for (const name of urls) {
      expect(existsSync(resolve(process.cwd(), 'site/assets/fonts', name)), name).toBe(true);
    }
  });

  it('keeps developer-facing accessibility labels in English', () => {
    const script = source('site/js/main-v31.js');
    expect(script).toContain('aria-label="Copy Discord ID"');
    expect(script).not.toContain('aria-label="Copiar Discord ID"');
  });

  // The 14-day withdrawal right on a distance contract survives unless the buyer expressly
  // asks for immediate delivery AND acknowledges losing it (2011/83/EU art. 16(m)). Ko-fi's
  // checkout cannot collect that, but delivery does not happen there — it happens when the
  // pass is activated here. Drop the checkbox and the acknowledgement silently disappears
  // while the refund policy still claims it was given, which is worse than never having it.
  it('gates pass activation behind an express consent checkbox', () => {
    const script = source('site/js/main-v31.js');
    expect(script).toContain('id="ppClaimConsent"');
    expect(script).toContain('claim.consent');
    // The guard must refuse when unticked — failing open would activate the pass with no
    // acknowledgement at all.
    expect(script).toMatch(/if \(!consent \|\| !consent\.checked\)/);
    expect(script).toContain('claim.consentRequired');
  });

  // The claim field takes the whole receipt URL now (extractReceiptCode, src/premium/claim.ts),
  // so the copy must stop teaching people to perform surgery on an address bar — "the code
  // after txid=" was never a reasonable thing to ask, and on the monthly receipt it actively
  // misled: the code sits mid-URL, so selecting to the end drags &mode=g along.
  //
  // Asserted as an absence, deliberately. Checking that ten languages each "say to paste the
  // link" is not something a string match can honestly do — but the surgical instruction is
  // one literal token, and its absence is checkable in every language.
  it('no longer asks buyers to extract the code from the URL', () => {
    const bundle = source('site/js/i18n-v28.js');
    const sandbox: { window: { VOZEN_I18N?: Record<string, Record<string, string>> } } = {
      window: {},
    };
    new Function('window', bundle)(sandbox.window);
    const all = sandbox.window.VOZEN_I18N ?? {};
    const langs = Object.keys(all);
    expect(langs.length).toBeGreaterThan(0);
    for (const lang of langs) {
      for (const key of [
        'claim.hint',
        'claim.placeholder',
        'claim.useReceiptCode',
        'claim.notfound',
      ]) {
        expect(all[lang][key], `${lang} ${key} exists`).toBeTruthy();
        expect(all[lang][key], `${lang} ${key} still says txid=`).not.toContain('txid=');
      }
    }
  });

  // Closing the receipt tab is not a dead end — Ko-fi emails the buyer a receipt — but the card
  // never said so, which made it one in practice. The line has to name the email first (the copy
  // every buyer has) and support second (the genuinely-stuck tail: guest, wrong or lost email).
  //
  // The `.js-support` wiring at the top of the file runs ONCE over the document at load, and the
  // claim card is injected later, after OAuth. An anchor leaning on that wiring would render with
  // no href at all — so the card must carry the URL itself. That is what the last two assertions
  // pin: a silent hrefless link is exactly the failure this line exists to prevent.
  it('offers a way back when the buyer no longer has the receipt', () => {
    const script = source('site/js/main-v31.js');
    const start = script.indexOf('function claimCard()');
    expect(start, 'claimCard() exists').toBeGreaterThan(-1);
    const rest = script.slice(start + 1);
    // Comments stripped: the assertion below is about the markup this function RENDERS, and a
    // comment explaining why the wiring is avoided must not read as using it.
    const card = rest.slice(0, rest.indexOf('\n  function ')).replace(/^\s*\/\/.*$/gm, '');
    expect(card).toContain('claim.lost');
    expect(card).toContain('${SUPPORT_URL}');
    expect(card, 'must not rely on the one-time .js-support wiring').not.toContain('js-support');
  });

  it('translates the recovery copy into every advertised site language', () => {
    const bundle = source('site/js/i18n-v28.js');
    const sandbox: { window: { VOZEN_I18N?: Record<string, Record<string, string>> } } = {
      window: {},
    };
    new Function('window', bundle)(sandbox.window);
    const all = sandbox.window.VOZEN_I18N ?? {};
    const langs = Object.keys(all);
    expect(langs.length).toBeGreaterThan(0);
    for (const lang of langs) {
      // Split in two on purpose: the sentence and the link label are separate keys so no
      // translation has to carry markup through esc().
      expect(all[lang]['claim.lost'], `${lang} claim.lost`).toBeTruthy();
      expect(all[lang]['claim.lostHelp'], `${lang} claim.lostHelp`).toBeTruthy();
    }
  });

  it('translates the consent copy into every advertised site language', () => {
    const bundle = source('site/js/i18n-v28.js');
    const sandbox: { window: { VOZEN_I18N?: Record<string, Record<string, string>> } } = {
      window: {},
    };
    new Function('window', bundle)(sandbox.window);
    const all = sandbox.window.VOZEN_I18N ?? {};
    const langs = Object.keys(all);
    expect(langs.length).toBeGreaterThan(0);
    for (const lang of langs) {
      // Untranslated consent text is not a cosmetic gap: someone who cannot read what they
      // are waiving has not knowingly waived it.
      expect(all[lang]['claim.consent'], `${lang} claim.consent`).toBeTruthy();
      expect(all[lang]['claim.consentRequired'], `${lang} claim.consentRequired`).toBeTruthy();
      expect(all[lang]['claim.consent'], `${lang} mentions the 14 days`).toContain('14');
    }
  });
});
