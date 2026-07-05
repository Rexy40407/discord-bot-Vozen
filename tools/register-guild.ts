/**
 * tools/register-guild.ts — regista os comandos por-SERVIDOR (instantâneo), em vez de
 * globalmente (que leva até ~1h a propagar). Útil para TESTAR comandos novos já.
 *
 * Corre com tsx: usa o token/clientId do .env (loadConfig), lista os servidores onde o
 * bot está (GET /users/@me/guilds) e faz o PUT dos comandos em cada um. Comandos de
 * servidor SOBREPÕEM-SE aos globais nesse servidor, por isso não há duplicados.
 *
 *   npx tsx tools/register-guild.ts
 */
import { REST, Routes } from 'discord.js';
import { commandDefs } from '../src/commands/index';
import { loadConfig } from '../src/config/index';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const rest = new REST({ version: '10' }).setToken(cfg.token);
  const guilds = (await rest.get(Routes.userGuilds())) as { id: string; name: string }[];
  if (!guilds.length) {
    console.error('O bot não está em nenhum servidor — convida-o primeiro.');
    process.exit(1);
  }
  for (const g of guilds) {
    await rest.put(Routes.applicationGuildCommands(cfg.clientId, g.id), { body: commandDefs });
    console.log(`✅ ${commandDefs.length} comandos registados em "${g.name}" (${g.id}) — já aparecem.`);
  }
  console.log('\nRecarrega o Discord (Ctrl+R) se não vires os comandos logo.');
}

main().catch((err) => {
  console.error('Falha a registar por-servidor:', err);
  process.exit(1);
});
