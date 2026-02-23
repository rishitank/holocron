# Holocron

> "Ancient knowledge crystals storing the wisdom of Force masters — accessed by agents to gain understanding."

A fully self-contained TypeScript tool that provides local codebase intelligence for Claude Code — exposed via MCP server, CLI, and REST API. Zero cloud account required. Zero background processes. Fully offline-capable.

---

## Features

- **Automatic context injection** — Intercepts every Claude Code prompt via `UserPromptSubmit` hook; silently injects relevant code snippets as `additionalContext` before the model sees the prompt. You never type a command.
- **Lazy git-aware indexing** — Checks the git HEAD SHA on every search. If nothing changed, returns in <1ms. If commits landed, only reindexes the changed files via `git diff-index`.
- **Hybrid BM25 + vector search** — FTS5 BM25 full-text search fused with sqlite-vec cosine similarity via Reciprocal Rank Fusion (RRF). Single SQLite file, no external processes.
- **AST-aware chunking** — Chunks code at function/class/method boundaries (not arbitrary line counts), improving retrieval precision by 20–35% vs sliding-window approaches.
- **SOTA embeddings** — Qwen3-Embedding (MTEB code benchmark 80.68, 2026 SOTA) via Ollama. Falls back to BM25-only when Ollama is unavailable.
- **Multiple inference backends** — Ollama, Anthropic (API key or Claude Code shim), any OpenAI-compatible endpoint (LiteLLM, vLLM, CCProxy).
- **MCP server** — Tools, Resources, and Prompts per the MCP 2025-11-25 spec. Integrates directly with Claude Code.
- **REST API** — Fastify server for programmatic access.
- **CLI** — Full command-line interface for manual use.

---

## Quick Start (Zero-Account, Offline)

```bash
# 1. Install
npm install -g holocron

# 2. Pull SOTA embeddings (recommended for semantic search)
ollama pull qwen3-embedding

# 3. Register Claude Code hooks + MCP server (one-time)
holocron plugin install

# 4. Restart Claude Code
# Done. Every prompt now gets codebase context injected automatically.
```

No API keys. No manual indexing commands. The Force flows automatically.

---

## Prerequisites

**Required**:
- Node.js ≥ 25.0.0

**Recommended** (for semantic search quality):
- [Ollama](https://ollama.ai) running locally
- `ollama pull qwen3-embedding` — SOTA code embeddings (MTEB 80.68)

**Optional**:
- Any Ollama chat model (`ollama pull codellama`) for `--ask` inference
- `ANTHROPIC_API_KEY` for Anthropic backend
- `@huggingface/transformers` for fully offline embeddings (no Ollama)

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Switches backend to Anthropic | — |
| `ANTHROPIC_BASE_URL` | Overrides Anthropic endpoint (e.g. Claude Code shim) | `https://api.anthropic.com` |
| `OLLAMA_BASE_URL` | Ollama server URL | `http://localhost:11434` |
| `DARTH_PROXY_PORT` | REST API port | `3666` |
| `DARTH_LOG_LEVEL` | Log level: `debug`\|`info`\|`warn`\|`error` | `info` |

---

## Claude Code Plugin (Zero-Touch)

`holocron plugin install` registers two hooks in `~/.claude/settings.json`:

- **`UserPromptSubmit`** — Before every Claude Code message, queries the MCP server, formats results into `<codebase_context>` XML, injects as `additionalContext`.
- **`SessionStart`** — Triggers a background freshness check so the first search of a session is fast.

**How context injection looks** (the model receives this transparently):

```xml
<codebase_context query="authentication flow" results="3">
<result rank="1" file="src/auth/login.ts" lines="45-89" symbol="handleLogin" score="0.94">
async function handleLogin(req: Request, res: Response): Promise<void> {
  ...
}
</result>
</codebase_context>
```

If no relevant context is found, the prompt passes through unmodified.

---

## MCP Server

Start the MCP server over stdio (used by Claude Code):

```bash
holocron mcp
```

### Tools

| Tool | Description |
|------|-------------|
| `search_codebase` | BM25 + vector search, returns formatted results |
| `enhance_prompt` | Injects codebase context into any prompt |
| `index_directory` | Manually trigger indexing of a directory |
| `ask_codebase` | RAG-enhanced question answering (requires inference backend) |

### Resources

| URI | Description |
|-----|-------------|
| `holocron://index/status` | Index health: file count, last SHA, last indexed timestamp |

### Prompts

| Name | Description |
|------|-------------|
| `code_context` | Reusable template that retrieves context for a query |

### Claude Code MCP config (`~/.claude/mcp_settings.json`)

```json
{
  "mcpServers": {
    "holocron": {
      "command": "holocron",
      "args": ["mcp"]
    }
  }
}
```

---

## CLI

```bash
# Index a directory (usually automatic — only needed manually on first run without git)
holocron index .

# Search
holocron search "authentication flow"
holocron search "login handler" --top 10

# Enhance a prompt with codebase context
holocron enhance "How does the login flow work?"

# Ask a question (requires inference backend)
holocron ask "How does authentication work?" --stream

# Start REST API server
holocron serve --port 3666

# Register Claude Code plugin hooks
holocron plugin install
```

---

## REST API

```bash
holocron serve --port 3666
```

### `POST /search`

```json
{ "query": "login handler", "maxResults": 5 }
```

### `POST /enhance`

```json
{ "prompt": "How does authentication work?", "maxResults": 5 }
```

### `POST /ask`

```json
{ "question": "What does handleLogin do?", "stream": false }
```

### `POST /index`

```json
{ "directory": "/path/to/repo" }
```

---

## Configuration

Configuration is resolved in priority order: CLI flags → environment variables → `.holocron.json` → defaults.

Create `.holocron.json` in your project root:

```json
{
  "context": {
    "embedder": "ollama",
    "ollamaEmbedModel": "qwen3-embedding",
    "chunker": "ast",
    "vectorStore": "sqlite"
  },
  "backend": {
    "type": "ollama",
    "baseUrl": "http://localhost:11434",
    "model": "codellama"
  },
  "api": {
    "port": 3666
  }
}
```

### Context options

| Key | Values | Default | Description |
|-----|--------|---------|-------------|
| `embedder` | `noop` \| `ollama` \| `transformers` | `ollama` | Embedding provider |
| `ollamaEmbedModel` | any Ollama model name | `qwen3-embedding` | Embedding model |
| `chunker` | `ast` \| `text` | `ast` | `ast` = regex function/class chunks |
| `vectorStore` | `sqlite` \| `memory` | `sqlite` | `sqlite` persists across restarts |
| `persistPath` | file path | `~/.holocron/index.db` | SQLite database location |

### Backend options

```json
{ "type": "ollama", "baseUrl": "http://localhost:11434", "model": "codellama" }
{ "type": "anthropic", "apiKey": "sk-ant-...", "model": "claude-opus-4-6" }
{ "type": "openai-compatible", "baseUrl": "http://localhost:8080", "model": "gpt-4o" }
```

---

## Architecture

```
Claude Code prompt
    │
    ▼ UserPromptSubmit hook
    │
    ▼ holocron hook user-prompt-submit
    │
    ├── GitTracker.checkFreshness()  — SHA check (<1ms if unchanged)
    │     └── git diff-index → incremental reindex if changed
    │
    ├── SqliteHybridStore.searchBM25()   — FTS5 full-text (porter unicode61)
    ├── SqliteHybridStore.searchVector() — cosine similarity (sqlite-vec)
    │
    ├── RRF fusion → top-K results
    │
    └── contextFormatter → <codebase_context> XML
          │
          ▼ injected as additionalContext
          ▼ model sees original prompt + relevant code
```

**Context engine is pluggable** via the `ContextEngine` interface:
- `LocalContextAdapter` — default, fully offline, single SQLite file

**Inference backend is pluggable** via the `InferenceBackend` interface:
- `OllamaBackend`
- `AnthropicBackend`
- `OpenAICompatibleBackend`

---

## Library Usage

```typescript
import { createContextEngine, createBackend, PromptEnhancer } from 'holocron';

const engine = await createContextEngine({
  mode: 'local',
  embedder: 'ollama',
  chunker: 'ast',
  vectorStore: 'sqlite',
});

await engine.indexDirectory('/path/to/repo');

const results = await engine.search('authentication flow', { maxResults: 5 });

// Or use the PromptEnhancer
const enhancer = new PromptEnhancer(engine);
const { enhancedPrompt, sources } = await enhancer.enhance('How does login work?');
```

---

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint

# Build
npm run build

# Test with coverage
npm run test:coverage
```

**Test matrix**: Node 22, 24, 25 via GitHub Actions CI.

---

## The Holocron Code

```
The holocron holds all knowledge,
for those with the will to seek it.
Through understanding, I gain clarity.
Through clarity, I gain mastery.
Through mastery, my code is unbroken.
The Force guides the search.
```

The knowledge of a thousand codebases, stored in a single SQLite file. No cloud required.
