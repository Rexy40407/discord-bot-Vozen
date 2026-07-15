// tools/register-guild.cjs — registers the GUILD-SCOPED slash commands in all
// servers where the bot is (or in a guild id passed via argv). Unlike the
// GLOBAL registration (registerCommands.ts), guild commands appear INSTANTLY — without
// the propagation delay (~1h) or the client cache. Useful to see a new option
// right away (e.g. the Kokoro engine in /voice set) without waiting for global propagation.
//
// The token comes from loadConfig() (which does require('dotenv/config')) — it is NEVER printed.
// Usage: node tools/register-guild.cjs [guildId]   (no arg = all of the bot's guilds)
//
// NOTE: a guild command with the same name OVERRIDES the global one in that server. To
// return to pure global later, run tools/clear-guild-commands.cjs.

const { REST, Routes } = require('discord.js');
const { loadConfig } = require('../dist/config/index.js');
const { commandDefs } = require('../dist/commands/index.js');

async function main() {
  const cfg = loadConfig();
  const rest = new REST({ version: '10' }).setToken(cfg.token);

  let guildIds = process.argv.slice(2).filter(Boolean);
  if (guildIds.length === 0) {
    const guilds = await rest.get(Routes.userGuilds());
    guildIds = guilds.map((g) => g.id);
    console.log(
      `[register-guild] bot está em ${guilds.length} servidor(es): ${guilds.map((g) => g.name).join(', ')}`,
    );
  }

  for (const gid of guildIds) {
    await rest.put(Routes.applicationGuildCommands(cfg.clientId, gid), { body: commandDefs });
    console.log(
      `[register-guild] ${commandDefs.length} commands registered in guild ${gid} (immediate).`,
    );
  }
  console.log(
    '[register-guild] done. New options, including Kokoro, are available after Ctrl+R in Discord.',
  );
}

main().catch((err) => {
  console.error('[register-guild] failed:', err?.message || err);
  process.exit(1);
});
