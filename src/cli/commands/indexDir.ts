import type { Command } from 'commander';
import { loadConfig } from '../../config/loader.js';
import { createContextEngine } from '../../context/index.js';

export function registerIndexDirCommand(program: Command): void {
  program
    .command('index <directory>')
    .description('Index a directory into the local codebase store')
    .option('--reset', 'Clear the existing index before re-indexing (use after switching embedders)')
    .action(async (directory: string, options: { reset?: boolean }) => {
      const config = loadConfig();
      const engine = await createContextEngine(config.context);
      try {
        if (options.reset) {
          process.stderr.write('[darth-proxy] Clearing existing index...\n');
          await engine.clearIndex();
        }
        process.stderr.write(`[darth-proxy] Indexing ${directory}...\n`);
        const result = await engine.indexDirectory(directory);
        process.stdout.write(
          `Indexed ${result.indexedFiles} files (${result.chunks} chunks) from ${directory}\n`,
        );
      } finally {
        await engine.dispose();
      }
    });
}
