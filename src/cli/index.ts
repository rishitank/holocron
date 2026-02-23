#!/usr/bin/env node
import { Command } from 'commander';
import { createRequire } from 'node:module';
import { registerIndexDirCommand } from './commands/indexDir.js';
import { registerSearchCommand } from './commands/search.js';
import { registerEnhanceCommand } from './commands/enhance.js';
import { registerAskCommand } from './commands/ask.js';
import { registerMcpCommand } from './commands/mcp.js';
import { registerServeCommand } from './commands/serve.js';
import { registerPluginInstallCommand } from './commands/pluginInstall.js';
import { registerHookCommand } from './commands/hook.js';

const require = createRequire(import.meta.url);
 
const pkg = require('../../package.json') as { version: string; description: string };

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('holocron')
    .description(pkg.description)
    .version(pkg.version);

  registerIndexDirCommand(program);
  registerSearchCommand(program);
  registerEnhanceCommand(program);
  registerAskCommand(program);
  registerMcpCommand(program);
  registerServeCommand(program);
  registerPluginInstallCommand(program);
  registerHookCommand(program);

  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[holocron] Error: ${message}\n`);
  process.exit(1);
});
