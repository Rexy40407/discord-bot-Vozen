// tools/upload-app-emojis.mjs
//
// Faz upload de TODOS os tiles-emoji do bot (assets/<grupo>/*.png — chess, wordle, …)
// como APPLICATION EMOJIS. App emojis funcionam em qualquer servidor sem Nitro nem
// slots de guild. IDEMPOTENTE: lista os existentes e cria só os que faltam. Corre uma
// vez (ou quando adicionares/trocares assets):
//   node tools/upload-app-emojis.mjs
//
// Precisa de DISCORD_TOKEN + CLIENT_ID no ambiente (o mesmo .env do bot).

import { REST, Routes } from 'discord.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../dist/config/index.js';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

/** Todos os PNGs em assets/<grupo>/*.png (um nível de subdiretórios). */
function collectPngs() {
  const out = [];
  for (const group of readdirSync(ASSETS)) {
    const dir = join(ASSETS, group);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.png')) out.push({ name: basename(file, '.png'), path: join(dir, file) });
    }
  }
  return out;
}

async function main() {
  const cfg = loadConfig();
  const rest = new REST({ version: '10' }).setToken(cfg.token);

  const existing = await rest.get(Routes.applicationEmojis(cfg.clientId));
  const have = new Map((existing.items ?? []).map((e) => [e.name, e.id]));

  const pngs = collectPngs();
  let created = 0;
  let skipped = 0;
  for (const { name, path } of pngs) {
    if (have.has(name)) {
      skipped++;
      continue;
    }
    const b64 = readFileSync(path).toString('base64');
    const res = await rest.post(Routes.applicationEmojis(cfg.clientId), {
      body: { name, image: `data:image/png;base64,${b64}` },
    });
    have.set(name, res.id);
    created++;
    console.log(`+ ${name} -> ${res.id}`);
  }

  console.log(`\nfeito: ${created} criados, ${skipped} já existiam, ${have.size} no total.`);
}

main().catch((err) => {
  console.error('[upload-app-emojis] falhou:', err);
  process.exit(1);
});
