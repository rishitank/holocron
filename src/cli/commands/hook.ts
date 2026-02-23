import type { Command } from 'commander';
import { loadConfig } from '../../config/loader.js';
import { createContextEngine } from '../../context/index.js';
import { formatContext } from '../../enhancers/contextFormatter.js';

interface UserPromptSubmitInput {
  prompt?: string;
  cwd?: string;
}

export function registerHookCommand(program: Command): void {
  const hookCmd = program.command('hook').description('Claude Code hook handlers');

  hookCmd
    .command('user-prompt-submit')
    .description('UserPromptSubmit hook: inject codebase context into prompt')
    .action(async () => {
      try {
        // Read JSON from stdin
        const raw = await readStdin();
        const input = JSON.parse(raw || '{}') as UserPromptSubmitInput;
        const { prompt = '' } = input;

        if (!prompt) {
          process.stdout.write('{}\n');
          return;
        }

        const config = loadConfig();
        const engine = await createContextEngine(config.context);
        try {
          const results = await engine.search(prompt, {
            maxResults: config.enhancer.maxContextResults,
          });
          const formatted = formatContext(results, prompt, {
            maxCharsPerChunk: config.enhancer.maxCharsPerChunk,
          });
          if (formatted) {
            process.stdout.write(JSON.stringify({ additionalContext: formatted }) + '\n');
          } else {
            process.stdout.write('{}\n');
          }
        } finally {
          await engine.dispose();
        }
      } catch {
        // Graceful degradation: never block Claude Code
        process.stdout.write('{}\n');
        process.exit(0);
      }
    });

  hookCmd
    .command('session-start')
    .description('SessionStart hook: warm up context engine lazily')
    .action(async () => {
      try {
        // Fire-and-forget: never block session start
        const raw = await readStdin();
        const input = JSON.parse(raw || '{}') as { cwd?: string };
        const _cwd = input.cwd ?? process.cwd();
        // Just return immediately — lazy indexing happens on first search
        process.stdout.write('{}\n');
      } catch {
        process.stdout.write('{}\n');
      }
    });
}

async function readStdin(): Promise<string> {
  const stdinPromise = new Promise<string>((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += String(chunk);
    });
    process.stdin.on('end', () => { resolve(data); });
    // Resolve immediately if stdin is TTY (interactive terminal, no pipe)
    if (process.stdin.isTTY) resolve('');
  });
  const timeoutPromise = new Promise<string>((_, reject) =>
    setTimeout(() => { reject(new Error('stdin timeout after 5s')); }, 5000),
  );
  return Promise.race([stdinPromise, timeoutPromise]).catch(() => '');
}
