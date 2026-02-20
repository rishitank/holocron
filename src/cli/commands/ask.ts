import type { Command } from 'commander';
import { loadConfig } from '../../config/loader.js';
import { createContextEngine } from '../../context/index.js';
import { createBackend } from '../../backends/backendFactory.js';
import { PromptEnhancer } from '../../enhancers/promptEnhancer.js';

export function registerAskCommand(program: Command): void {
  program
    .command('ask <question>')
    .description('Answer a question grounded in the indexed codebase')
    .option('--stream', 'Stream the response token by token')
    .option('--top <n>', 'Max context results', '5')
    .action(async (question: string, opts: { stream: boolean; top: string }) => {
      const config = loadConfig();
      const engine = await createContextEngine(config.context);
      const backend = createBackend(config.backend);
      try {
        const enhancer = new PromptEnhancer(engine);
        const enhanced = await enhancer.enhance(question, {
          maxResults: parseInt(opts.top, 10),
        });

        if (opts.stream) {
          for await (const chunk of backend.stream({
            messages: [{ role: 'user', content: enhanced.enhancedPrompt }],
          })) {
            process.stdout.write(chunk.content);
          }
          process.stdout.write('\n');
        } else {
          const response = await backend.complete({
            messages: [{ role: 'user', content: enhanced.enhancedPrompt }],
          });
          process.stdout.write(response.content);
          process.stdout.write('\n');
        }
      } finally {
        await engine.dispose();
      }
    });
}
