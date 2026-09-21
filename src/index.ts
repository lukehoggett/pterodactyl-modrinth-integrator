import { Command } from 'commander';
import { ModManager } from './core/mod-manager.js';

const program = new Command();
const modManager = new ModManager();

program
  .name('ptero-mod-integrator')
  .description('CLI integration between Pterodactyl and Modrinth')
  .version('1.0.0');

// Command: Update
program
  .command('update')
  .description('Check and update existing mods on a target server')
  .requiredOption('-s, --server <id>', 'The Pterodactyl Server ID')
  .option('-d, --debug', 'Output raw API responses for debugging')
  .option('-m, --minecraft <version>', 'Explicitly set the Minecraft version')
  .option('-l, --loader <loader>', 'Explicitly set the mod loader (e.g., fabric, forge)')
  .option('-c, --channel <channel>', 'Release channel (release, beta, alpha)', 'release')
  .action(async (options) => {
      try {
          await modManager.updateExistingMods(options.server, { 
              debug: options.debug,
              minecraft: options.minecraft,
              loader: options.loader,
              channel: options.channel
          });
      } catch (error: any) {
          console.error("An error occurred during update:", error.message);
      }
  });

// Command: Search (Future structure example)
program
  .command('search')
  .description('Search the Modrinth catalog for new mods')
  .requiredOption('-q, --query <term>', 'The search term')
  .action(async (options) => {
      try {
          await modManager.searchNewMods(options.query);
      } catch (error: any) {
          console.error("An error occurred during search:", error.message);
      }
  });

program.parse();