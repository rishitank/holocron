import type { Command } from 'commander';
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
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

interface KeybindingContext {
  context: string;
  bindings: Record<string, string | null>;
}

interface KeybindingsFile {
  $schema?: string;
  $docs?: string;
  bindings: KeybindingContext[];
}

function readJsonFile<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function hasHook(matchers: HookMatcher[], command: string): boolean {
  return matchers.some((m) => m.hooks.some((h) => h.command === command));
}

// Skill file contents embedded here so they work regardless of npm install location.
const SKILLS: Record<string, string> = {
  'search.md': `Search the codebase for: $ARGUMENTS

Use the search_codebase MCP tool with query="$ARGUMENTS" and return formatted results showing file paths and relevant code chunks.
`,
  'ask.md': `Answer using codebase context for: $ARGUMENTS

Use the ask_codebase MCP tool to get a RAG-enhanced answer grounded in the actual code. Include relevant file paths and code snippets in your response.
`,
  'enhance.md': `Enhance the following prompt with relevant codebase context: $ARGUMENTS

Use the enhance_prompt MCP tool with prompt="$ARGUMENTS" to get the context-injected version.
Present the enhanced prompt in a code block so the user can review it, then ask whether to proceed with it.
`,
};

// Bash script invoked by Claude Code's external editor (ctrl+p → chat:externalEditor).
// Claude Code calls it with the path to a temp file containing the current chat input.
// The script runs darth-proxy enhance on the content and writes the result back.
const ENHANCE_EDITOR_SCRIPT = `#!/bin/bash
# darth-proxy prompt enhancer — invoked as $VISUAL by Claude Code (ctrl+p)
# Usage: called by Claude Code with a temp file path as the sole argument.
set -e

TMPFILE="$1"
if [ -z "$TMPFILE" ] || [ ! -f "$TMPFILE" ]; then
  exit 0
fi

PROMPT=$(cat "$TMPFILE")
if [ -z "$(echo "$PROMPT" | tr -d '[:space:]')" ]; then
  exit 0
fi

ENHANCED=$(darth-proxy enhance "$PROMPT" 2>/dev/null)
if [ -n "$ENHANCED" ]; then
  printf '%s' "$ENHANCED" > "$TMPFILE"
fi
`;

export function registerPluginInstallCommand(program: Command): void {
  program
    .command('plugin install')
    .description('Register darth-proxy hooks, MCP server, slash commands, and ctrl+p keybinding in Claude Code')
    .action(() => {
      const home = homedir();
      const settingsPath = join(home, '.claude', 'settings.json');
      const mcpSettingsPath = join(home, '.claude', 'mcp_settings.json');
      const keybindingsPath = join(home, '.claude', 'keybindings.json');
      const commandsDir = join(home, '.claude', 'commands', 'darth-proxy');
      const editorScriptPath = join(home, '.darth-proxy', 'enhance-editor.sh');

      // ── 1. Register hooks in ~/.claude/settings.json ─────────────────────
      const settings = readJsonFile<ClaudeSettings>(settingsPath, {});
      settings.hooks ??= {};

      const userPromptHook = 'darth-proxy hook user-prompt-submit';
      settings.hooks['UserPromptSubmit'] ??= [];
      if (!hasHook(settings.hooks['UserPromptSubmit'], userPromptHook)) {
        settings.hooks['UserPromptSubmit'].push({
          matcher: '',
          hooks: [{ type: 'command', command: userPromptHook }],
        });
      }

      const sessionStartHook = 'darth-proxy hook session-start';
      settings.hooks['SessionStart'] ??= [];
      if (!hasHook(settings.hooks['SessionStart'], sessionStartHook)) {
        settings.hooks['SessionStart'].push({
          matcher: '',
          hooks: [{ type: 'command', command: sessionStartHook }],
        });
      }

      writeJsonFile(settingsPath, settings);

      // ── 2. Register MCP server in ~/.claude/mcp_settings.json ────────────
      const mcpSettings = readJsonFile<ClaudeSettings>(mcpSettingsPath, {});
      mcpSettings.mcpServers ??= {};
      mcpSettings.mcpServers['darth-proxy'] = {
        command: 'darth-proxy',
        args: ['mcp'],
        env: {},
      };
      writeJsonFile(mcpSettingsPath, mcpSettings);

      // ── 3. Install slash commands to ~/.claude/commands/darth-proxy/ ──────
      mkdirSync(commandsDir, { recursive: true });
      for (const [filename, content] of Object.entries(SKILLS)) {
        writeFileSync(join(commandsDir, filename), content, 'utf8');
      }

      // ── 4. Register ctrl+p → chat:externalEditor in keybindings.json ─────
      const defaultKeybindings: KeybindingsFile = {
        $schema: 'https://www.schemastore.org/claude-code-keybindings.json',
        $docs: 'https://code.claude.com/docs/en/keybindings',
        bindings: [],
      };
      const keybindings = readJsonFile<KeybindingsFile>(keybindingsPath, defaultKeybindings);
      keybindings.$schema ??= 'https://www.schemastore.org/claude-code-keybindings.json';
      keybindings.$docs ??= 'https://code.claude.com/docs/en/keybindings';
      keybindings.bindings ??= [];

      let chatContext = keybindings.bindings.find((b) => b.context === 'Chat');
      if (!chatContext) {
        chatContext = { context: 'Chat', bindings: {} };
        keybindings.bindings.push(chatContext);
      }
      // Only set if not already customised by the user
      chatContext.bindings['ctrl+p'] ??= 'chat:externalEditor';
      writeJsonFile(keybindingsPath, keybindings);

      // ── 5. Write enhance-editor.sh (invoked by ctrl+p / chat:externalEditor) ─
      mkdirSync(dirname(editorScriptPath), { recursive: true });
      writeFileSync(editorScriptPath, ENHANCE_EDITOR_SCRIPT, 'utf8');
      chmodSync(editorScriptPath, 0o755);

      process.stdout.write(
        [
          '',
          'The Force flows through Claude Code. All installations complete:',
          '',
          '  ✓ UserPromptSubmit hook   — context auto-injected on every prompt',
          '  ✓ MCP server              — search_codebase / ask_codebase / enhance_prompt tools',
          '  ✓ Slash commands          — /darth-proxy:search  /darth-proxy:ask  /darth-proxy:enhance',
          '  ✓ ctrl+p keybinding       — opens the prompt enhancer (chat:externalEditor)',
          `  ✓ Enhance script          — ${editorScriptPath}`,
          '',
          'One step required to activate ctrl+p prompt enhancement:',
          '',
          `  export VISUAL="${editorScriptPath}"`,
          '',
          'Add the line above to your ~/.zshrc (or ~/.bashrc), then restart Claude Code.',
          'Press ctrl+p with text in the input box to transform it with codebase context.',
          '',
        ].join('\n'),
      );
    });
}
