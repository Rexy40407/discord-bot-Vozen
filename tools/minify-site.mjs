// tools/minify-site.mjs
//
// Constrói site-dist/ a partir de site/, MINIFICANDO o que é servido em produção:
//   - index.html  -> HTML compacto (+ CSS/JS inline minificados)
//   - *.css / *.js -> minificados (o "código" da página principal deixa de ser
//                     legível num Ctrl+U casual, e carrega mais rápido)
//   - privacy.html / terms.html -> COPIADAS TAL COMO ESTÃO (legais: têm de ficar
//                     legíveis para utilizadores, Discord e motores de busca)
//   - assets/, favicon, etc. -> copiados
//
// NB honesto: isto NÃO esconde a página. A aba "Elements" do F12 mostra sempre o
// DOM já desenhado (o browser re-embeleza-o), e a aba Network mostra o ficheiro cru.
// A minificação só trava o copy-paste casual e melhora o tempo de carregamento; o
// código-fonte limpo continua no Git (site/), só a saída publicada é compacta.
//
// Puro Node ESM; corre com `npm run build:site`. Não faz parte do build TypeScript.

import { readdir, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { join, dirname, extname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify as minifyHtml } from 'html-minifier-terser';
import { minify as minifyJs } from 'terser';
import CleanCSS from 'clean-css';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'site');
const OUT = join(ROOT, 'site-dist');

// Só a página principal é minificada. As páginas legais ficam legíveis.
const MINIFY_HTML = new Set(['index.html']);

const HTML_OPTS = {
  collapseWhitespace: true,
  removeComments: true,
  minifyCSS: true, // <style> inline
  minifyJS: true, // <script> inline
  removeRedundantAttributes: true,
  removeScriptTypeAttributes: true,
  useShortDoctype: true,
};

// Guarda anti-mojibake: apanha UTF-8 lido/gravado como Windows-1252 (o erro do
// PS 5.1 Get-Content|Set-Content). Digrafos específicos que NUNCA aparecem em
// UTF-8 correto — não apanha `â` sozinho (ex.: "âmbar" é legítimo).
const MOJIBAKE = /â‚¬|ðŸ|â€™|â€œ|â€|â€“|â€”|Ã©|Ã¡|Ã£|Ã§|Ãµ|Ã­|Ã³|Ãº|Ã \b|Â·|Â«|Â»|âˆ'/;
const TEXT_EXT = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt', '.webmanifest']);

/** Falha o build se algum ficheiro de texto tiver mojibake (corrupção de encoding). */
function assertNoMojibake(rel, text) {
  const m = text.match(MOJIBAKE);
  if (m) {
    const line = text.slice(0, m.index).split('\n').length;
    throw new Error(
      `mojibake detetado em ${rel}:${line} (sequência "${m[0]}") — ` +
        `ficheiro UTF-8 corrompido (lido como Windows-1252?). Restaura do git.`,
    );
  }
}

/** Lista recursiva de todos os ficheiros sob `dir` (caminhos absolutos). */
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

async function run() {
  await rm(OUT, { recursive: true, force: true });
  const files = await walk(SRC);
  let minified = 0;
  let copied = 0;
  for (const file of files) {
    const rel = relative(SRC, file);
    const outPath = join(OUT, rel);
    await mkdir(dirname(outPath), { recursive: true });
    const ext = extname(file).toLowerCase();

    // Ficheiros de texto: lê uma vez e valida encoding antes de processar.
    if (TEXT_EXT.has(ext)) {
      const text = await readFile(file, 'utf8');
      assertNoMojibake(rel, text);

      if (ext === '.html' && MINIFY_HTML.has(basename(file))) {
        await writeFile(outPath, await minifyHtml(text, HTML_OPTS));
        minified++;
      } else if (ext === '.js') {
        const res = await minifyJs(text, { compress: true, mangle: true });
        await writeFile(outPath, res.code ?? text);
        minified++;
      } else if (ext === '.css') {
        const res = new CleanCSS({ returnPromise: false }).minify(text);
        if (res.errors.length)
          throw new Error(`clean-css falhou em ${rel}: ${res.errors.join('; ')}`);
        await writeFile(outPath, res.styles);
        minified++;
      } else {
        await writeFile(outPath, text); // páginas legais (privacy/terms), json, svg
        copied++;
      }
    } else {
      await copyFile(file, outPath); // assets binários, favicon, imagens, mp3
      copied++;
    }
  }
  console.log(
    `[minify-site] ${minified} ficheiro(s) minificado(s), ${copied} copiado(s) -> site-dist/`,
  );
}

run().catch((err) => {
  console.error('[minify-site] falhou:', err);
  process.exit(1);
});
