import type { Command } from 'commander';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

interface HookEntry {
  type: string;
  command: string;
}

interface HookMatcher {
  matcher: string;
  hooks: HookEntry[];
}

interface ClaudeSettings {
  hooks?: Record<string, HookMatcher[]>;
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

function readJsonFile(path: string): ClaudeSettings {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ClaudeSettings;
  } catch {
    return {};
  }
}

function writeJsonFile(path: string, data: ClaudeSettings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function hasHook(matchers: HookMatcher[], command: string): boolean {
  return matchers.some((m) => m.hooks.some((h) => h.command === command));
}

export function registerPluginInstallCommand(program: Command): void {
  program
    .command('plugin install')
    .description('Register darth-proxy hooks and MCP server in Claude Code settings')
    .action(() => {
      const settingsPath = join(homedir(), '.claude', 'settings.json');
      const mcpSettingsPath = join(homedir(), '.claude', 'mcp_settings.json');

      // ── 1. Register hooks in ~/.claude/settings.json ─────────────────────
      const settings = readJsonFile(settingsPath);
      settings.hooks ??= {};

      // UserPromptSubmit hook
      settings.hooks['UserPromptSubmit'] ??= [];
      const userPromptHook = 'darth-proxy hook user-prompt-submit';
      if (!hasHook(settings.hooks['UserPromptSubmit'], userPromptHook)) {
        settings.hooks['UserPromptSubmit'].push({
          matcher: '',
          hooks: [{ type: 'command', command: userPromptHook }],
        });
      }

      // SessionStart hook
      settings.hooks['SessionStart'] ??= [];
      const sessionStartHook = 'darth-proxy hook session-start';
      if (!hasHook(settings.hooks['SessionStart'], sessionStartHook)) {
        settings.hooks['SessionStart'].push({
          matcher: '',
          hooks: [{ type: 'command', command: sessionStartHook }],
        });
      }

      writeJsonFile(settingsPath, settings);

      // ── 2. Register MCP server in ~/.claude/mcp_settings.json ────────────
      const mcpSettings = readJsonFile(mcpSettingsPath);
      mcpSettings.mcpServers ??= {};
      mcpSettings.mcpServers['darth-proxy'] = {
        command: 'darth-proxy',
        args: ['mcp'],
        env: {},
      };
      writeJsonFile(mcpSettingsPath, mcpSettings);

      process.stdout.write(
        'The Force flows through Claude Code. Context will be injected automatically.\n',
      );
    });
}
