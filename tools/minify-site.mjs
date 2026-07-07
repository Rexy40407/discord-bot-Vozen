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

    if (ext === '.html' && MINIFY_HTML.has(basename(file))) {
      const out = await minifyHtml(await readFile(file, 'utf8'), HTML_OPTS);
      await writeFile(outPath, out);
      minified++;
    } else if (ext === '.js') {
      const res = await minifyJs(await readFile(file, 'utf8'), { compress: true, mangle: true });
      await writeFile(outPath, res.code ?? (await readFile(file, 'utf8')));
      minified++;
    } else if (ext === '.css') {
      const res = new CleanCSS({ returnPromise: false }).minify(await readFile(file, 'utf8'));
      if (res.errors.length)
        throw new Error(`clean-css falhou em ${rel}: ${res.errors.join('; ')}`);
      await writeFile(outPath, res.styles);
      minified++;
    } else {
      await copyFile(file, outPath); // páginas legais, assets, favicon
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
