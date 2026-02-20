import type { Command } from 'commander';
import { loadConfig } from '../../config/loader.js';
import { createContextEngine } from '../../context/index.js';
import { PromptEnhancer } from '../../enhancers/promptEnhancer.js';

export function registerEnhanceCommand(program: Command): void {
  program
    .command('enhance <prompt>')
    .description('Inject relevant codebase context into a prompt')
    .option('--placement <mode>', 'prefix | suffix | both', 'prefix')
    .option('--max-results <n>', 'Max context results', '5')
    .action(async (prompt: string, opts: { placement: string; maxResults: string }) => {
      const config = loadConfig();
      const engine = await createContextEngine(config.context);
      try {
        const enhancer = new PromptEnhancer(engine);
        const result = await enhancer.enhance(prompt, {
          placement: opts.placement as 'prefix' | 'suffix' | 'both',
          maxResults: parseInt(opts.maxResults, 10),
        });
        process.stdout.write(result.enhancedPrompt);
        process.stdout.write('\n');
      } finally {
        await engine.dispose();
      }
    });
}
