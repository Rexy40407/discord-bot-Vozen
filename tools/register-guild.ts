/**
 * tools/register-guild.ts — regista os comandos por-SERVIDOR (instantâneo), em vez de
 * globalmente (que leva até ~1h a propagar). Útil para TESTAR comandos novos já.
 *
 * ATENÇÃO: comandos de servidor NÃO substituem os globais — o Discord mostra os DOIS
 * conjuntos no picker (comandos DUPLICADOS). Por isso isto é uma ferramenta temporária
 * de teste: assim que os globais propagarem, corre `--clear` para remover os de
 * servidor e voltar a ter cada comando UMA vez.
 *
 *   npx tsx tools/register-guild.ts           # regista por-servidor (aparece já, DUPLICA)
 *   npx tsx tools/register-guild.ts --clear   # limpa os por-servidor (fica só o global)
 */
import { REST, Routes } from 'discord.js';
import { commandDefs } from '../src/commands/index';
import { loadConfig } from '../src/config/index';

async function main(): Promise<void> {
  const clear = process.argv.includes('--clear');
  const cfg = loadConfig();
  const rest = new REST({ version: '10' }).setToken(cfg.token);
  const guilds = (await rest.get(Routes.userGuilds())) as { id: string; name: string }[];
  if (!guilds.length) {
    console.error('O bot não está em nenhum servidor — convida-o primeiro.');
    process.exit(1);
  }
  for (const g of guilds) {
    const body = clear ? [] : commandDefs;
    await rest.put(Routes.applicationGuildCommands(cfg.clientId, g.id), { body });
    console.log(
      clear
        ? `🧹 comandos por-servidor LIMPOS em "${g.name}" (${g.id}) — fica só o conjunto global.`
        : `✅ ${commandDefs.length} comandos registados em "${g.name}" (${g.id}) — já aparecem (DUPLICADOS com os globais até correres --clear).`,
    );
  }
  console.log('\nRecarrega o Discord (Ctrl+R) se não vires a mudança logo.');
}

main().catch((err) => {
  console.error('Falha a registar por-servidor:', err);
  process.exit(1);
});
