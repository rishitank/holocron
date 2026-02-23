import type { Command } from 'commander';
import { loadConfig } from '../../config/loader.js';
import { createContextEngine } from '../../context/index.js';
import { createBackend } from '../../backends/backendFactory.js';
import { createApiServer } from '../../api/server.js';

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start the REST API server')
    .option('--port <n>', 'Port to listen on', '3666')
    .option('--host <h>', 'Host to bind to', '127.0.0.1')
    .action(async (opts: { port: string; host: string }) => {
      const config = loadConfig();
      const engine = await createContextEngine(config.context);
      const backend = createBackend(config.backend);
      const app = createApiServer({ contextEngine: engine, inferenceBackend: backend });

      const port = parseInt(opts.port, 10);
      const host = opts.host;
      await app.listen({ port, host });
      process.stderr.write(`[holocron] REST API listening on http://${host}:${port}\n`);
    });
}
