import type { Command } from 'commander';
import { loadConfig } from '../../config/loader.js';
import { createContextEngine } from '../../context/index.js';
import { formatContext } from '../../enhancers/contextFormatter.js';

export function registerSearchCommand(program: Command): void {
  program
    .command('search <query>')
    .description('Search the indexed codebase')
    .option('--top <n>', 'Max results', '5')
    .action(async (query: string, opts: { top: string }) => {
      const config = loadConfig();
      const engine = await createContextEngine(config.context);
      try {
        const results = await engine.search(query, { maxResults: parseInt(opts.top, 10) });
        const formatted = formatContext(results, query);
        process.stdout.write(formatted || `No results found for: ${query}\n`);
        process.stdout.write('\n');
      } finally {
        await engine.dispose();
      }
    });
}
