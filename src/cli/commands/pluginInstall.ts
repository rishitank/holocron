import type { Command } from 'commander';
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

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
// Claude Code calls the script with the path to a temp file holding the current input.
// While this script runs, Claude Code LOCKS the input box (it is read-only).
// Visual feedback (spinner, "enhancing" label) is printed to the terminal via tput.
// When the script exits, Claude Code reads the enriched content back into the input.
const ENHANCE_EDITOR_SCRIPT = `#!/bin/bash
# darth-proxy prompt enhancer — invoked as $VISUAL by Claude Code (ctrl+p)
# Claude Code calls this with a temp file path; the input box is locked until we exit.

TMPFILE="$1"
if [ -z "$TMPFILE" ] || [ ! -f "$TMPFILE" ]; then
  exit 0
fi

PROMPT=$(cat "$TMPFILE")
if [ -z "$(echo "$PROMPT" | tr -d '[:space:]')" ]; then
  exit 0
fi

# ── Visual feedback: print an "enhancing" indicator to the terminal ────────────
# tput sgr0 resets colours; tput setaf 3 = yellow; tput setaf 2 = green.
# These codes are ignored gracefully if the terminal does not support them.
RESET=$(tput sgr0 2>/dev/null || true)
YELLOW=$(tput setaf 3 2>/dev/null || true)
GREEN=$(tput setaf 2 2>/dev/null || true)
BOLD=$(tput bold 2>/dev/null || true)

printf '%s' "$YELLOW$BOLD⚡ darth-proxy: enhancing prompt with codebase context...$RESET " >&2

ENHANCED=$(darth-proxy enhance "$PROMPT" 2>/dev/null)

if [ -n "$ENHANCED" ]; then
  printf '%s\\n' "$GREEN✓ done$RESET" >&2
  printf '%s' "$ENHANCED" > "$TMPFILE"
else
  printf '%s\\n' "(no context found — prompt unchanged)" >&2
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
          '  ✓ ctrl+p keybinding       — triggers chat:externalEditor (input locked while enhancing)',
          `  ✓ Enhance script          — ${editorScriptPath}`,
          '',
          'One step required to activate ctrl+p prompt enhancement:',
          '',
          `  export VISUAL="${editorScriptPath}"`,
          '',
          'Add the line above to your ~/.zshrc (or ~/.bashrc), then restart Claude Code.',
          '',
          'ctrl+p behaviour:',
          '  1. Input box locks (read-only) while darth-proxy searches the codebase',
          '  2. Terminal shows: ⚡ enhancing... → ✓ done',
          '  3. Input box is restored with the context-enriched prompt — review and send',
          '',
          'Alternatively, install via Claude Code plugin system (no manual settings editing):',
          `  /plugin marketplace add ${resolve(fileURLToPath(import.meta.url), '../../../../.claude-plugin')}`,
          '  Then open the Plugin dialog and install darth-proxy from the marketplace.',
          '',
        ].join('\n'),
      );
    });
}
