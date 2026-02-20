import type { Command } from 'commander';
import { loadConfig } from '../../config/loader.js';
import { createContextEngine } from '../../context/index.js';
import { createBackend } from '../../backends/backendFactory.js';
import { startMcpServer } from '../../mcp/server.js';

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('Start the MCP server over stdio')
    .action(async () => {
      const config = loadConfig();
      const engine = await createContextEngine(config.context);
      const backend = createBackend(config.backend);
      await startMcpServer({ contextEngine: engine, inferenceBackend: backend });
    });
}
