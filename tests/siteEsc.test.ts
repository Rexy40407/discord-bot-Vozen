import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// TEST-05: a função `esc()` do painel do site escapa HTML antes de o injetar no DOM — é a
// barreira anti-XSS de dados que vêm da API (nomes, e-mails, estado premium). Não a
// extraímos para um módulo (o site carrega por <script> simples, não módulos — mexer nisso
// arriscava o load). Em vez disso, LEMOS a fonte real, isolamos a expressão do `esc` e
// avaliamo-la num sandbox — testa o código que corre em produção sem alterar o site. Se o
// prettier reformatar o `esc`, este teste falha alto (é de propósito).

// cwd = raiz do repo quando o vitest corre (evita import.meta, banido no output CommonJS
// do tsconfig.test.json). O bundle muda de nome a cada cache-bust (main-vN.js) — encontramo-lo.
const JS_DIR = join(process.cwd(), 'site', 'js');
const MAIN_JS = readdirSync(JS_DIR).find((f) => /^main-v\d+\.js$/.test(f));
if (!MAIN_JS) throw new Error('não encontrei site/js/main-v*.js (bundle principal do site)');
const SRC = readFileSync(join(JS_DIR, MAIN_JS), 'utf8');

function extractEsc(): (s: unknown) => string {
  // Captura `(s) => String(s).replace( ... \n    );` — do `(s) =>` até ao `);` que fecha o replace.
  const m = SRC.match(/const esc =\s*(\(s\)\s*=>[\s\S]*?\n\s*\)\s*);/);
  if (!m) throw new Error(`não encontrei a expressão do esc em ${MAIN_JS} (mudou o formato?)`);
  return eval('(' + m[1] + ')') as (s: unknown) => string;
}

describe('site esc() — escaping anti-XSS do painel (fonte real)', () => {
  const esc = extractEsc();

  it('escapa os 5 caracteres perigosos', () => {
    expect(esc('&')).toBe('&amp;');
    expect(esc('<')).toBe('&lt;');
    expect(esc('>')).toBe('&gt;');
    expect(esc('"')).toBe('&quot;');
    expect(esc("'")).toBe('&#39;');
  });

  it('neutraliza um payload de <script>', () => {
    expect(esc('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('neutraliza um break-out de atributo', () => {
    expect(esc('" onmouseover="alert(1)')).toBe('&quot; onmouseover=&quot;alert(1)');
  });

  it('deixa texto benigno intacto', () => {
    expect(esc('Diogo #1234')).toBe('Diogo #1234');
    expect(esc('café ☕ 中文')).toBe('café ☕ 中文');
  });

  it('coage não-strings via String() sem rebentar', () => {
    expect(esc(42)).toBe('42');
    expect(esc(null)).toBe('null');
    expect(esc(undefined)).toBe('undefined');
  });
});
