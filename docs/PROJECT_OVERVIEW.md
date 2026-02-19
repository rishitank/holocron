# Darth Proxy

> *"I find your lack of free inference disturbing."*

**Darth Proxy** is an open-source adapter layer that harnesses the power of the [Augment Code SDK](https://docs.augmentcode.com/cli/sdk) — specifically its **Context Engine** and **Prompt Enhancer** — while routing all AI/model inference requests to alternative backends instead of Augment's cloud infrastructure.

This allows developers to leverage Augment Code's industry-leading codebase intelligence **for free** (or at minimal cost) by proxying inference to:

- **Claude Code** (Anthropic's CLI agent)
- **Ollama** (local open-source models)
- **Any OpenAI-compatible API** (custom local proxy servers, LiteLLM, etc.)

---

## Table of Contents

- [Vision](#vision)
- [Problem Statement](#problem-statement)
- [Architecture](#architecture)
- [Core Components](#core-components)
- [Augment Code SDK Overview](#augment-code-sdk-overview)
- [Context Engine](#context-engine)
- [Prompt Enhancer](#prompt-enhancer)
- [Integration Targets](#integration-targets)
- [Proxy Strategies](#proxy-strategies)
- [Delivery Formats](#delivery-formats)
- [Technology Stack](#technology-stack)
- [Project Roadmap](#project-roadmap)
- [References](#references)

---

## Vision

The Augment Code platform has built one of the most advanced **semantic code understanding engines** in the industry — capable of indexing hundreds of thousands of files in real-time, understanding cross-repository dependencies, and enriching prompts with highly relevant codebase context. This Context Engine improved agent performance by **70%+** across Claude Code, Cursor, and Codex in benchmarks.

However, the full power of the platform is gated behind Augment's paid cloud infrastructure and their proprietary inference stack.

**Darth Proxy** decouples the intelligence layer (Context Engine + Prompt Enhancer) from the inference layer, allowing developers to:

1. **Use the Context Engine** for semantic code search and codebase-aware context retrieval
2. **Use the Prompt Enhancer** to automatically enrich simple prompts with relevant codebase context
3. **Route all LLM inference** to free or self-hosted alternatives (Claude Code, Ollama, local servers)
4. **Expose everything via MCP** so any MCP-compatible agent can benefit
5. **Build Claude Code plugins** that leverage Augment's intelligence without Augment's costs

---

## Problem Statement

| Problem | Impact |
|---------|--------|
| Augment Code's Context Engine is the best-in-class semantic code indexer | Locked behind their paid platform |
| The Prompt Enhancer dramatically improves prompt quality | Only available within Augment's ecosystem |
| All inference routes through Augment's custom H100 infrastructure | No option to use your own models |
| The SDK exists but tightly couples context retrieval with their inference | Difficult to use context features independently |
| Developers who use Claude Code, Ollama, or other tools miss out on this intelligence | Fragmented developer experience |

**Darth Proxy solves this** by intercepting the SDK's model request pipeline and rerouting inference while preserving access to the Context Engine and Prompt Enhancer.

---

## Architecture

```
+------------------------------------------------------------------+
|                        Developer Interface                        |
|          Claude Code  |  IDE Plugin  |  CLI  |  MCP Client       |
+------------+---------------------+------------------+-------------+
             |                     |                  |
             v                     v                  v
+------------------------------------------------------------------+
|                      DARTH PROXY LAYER                           |
|                                                                  |
|  +--------------------+    +--------------------+                |
|  |   Context Engine   |    |  Prompt Enhancer   |                |
|  |     Adapter        |    |     Adapter        |                |
|  | (Augment SDK)      |    | (Augment SDK)      |                |
|  +--------+-----------+    +--------+-----------+                |
|           |                         |                            |
|           v                         v                            |
|  +--------------------------------------------------+           |
|  |           Unified Context Pipeline                |           |
|  |  - Semantic search results                        |           |
|  |  - Enhanced prompts with codebase context         |           |
|  |  - File indexing and relationship mapping         |           |
|  +------------------------+-------------------------+           |
|                           |                                      |
|  +------------------------v-------------------------+           |
|  |           Inference Router / Proxy                |           |
|  |                                                   |           |
|  |  +-----------+  +-----------+  +---------------+ |           |
|  |  |  Claude   |  |  Ollama   |  | OpenAI-Compat | |           |
|  |  |  Code     |  |  Local    |  | Custom Proxy  | |           |
|  |  |  Backend  |  |  Backend  |  | Backend       | |           |
|  |  +-----------+  +-----------+  +---------------+ |           |
|  +--------------------------------------------------+           |
|                                                                  |
+------------------------------------------------------------------+
             |                     |                  |
             v                     v                  v
+------------------------------------------------------------------+
|                     Delivery Layer                                |
|       MCP Server  |  Claude Code Plugin  |  REST API  |  CLI     |
+------------------------------------------------------------------+
```

---

## Core Components

### 1. Context Engine Adapter

Wraps the Augment Code Context Engine SDK to provide:

- **Real-time semantic indexing** of local codebases
- **Semantic search** across indexed files (not just text matching)
- **Cross-file relationship mapping** and dependency analysis
- **Commit history awareness** (Context Lineage)
- **State persistence** (export/import index state)

The adapter uses two SDK classes:

| Class | Mode | Use Case |
|-------|------|----------|
| `DirectContext` | Explicit file indexing via API | Fine-grained control, CI/CD pipelines |
| `FileSystemContext` | Automatic directory watching | Real-time development workflows |

### 2. Prompt Enhancer Adapter

Wraps the Augment Prompt Enhancer to:

- Take simple developer prompts (e.g., "fix the login bug")
- Automatically enrich them with relevant codebase context
- Include file paths, function signatures, architectural patterns, and conventions
- Return a comprehensive, context-aware prompt ready for any LLM

### 3. Inference Router

The core proxy component that:

- Intercepts outbound model/inference requests from the SDK
- Routes them to the configured backend (Claude Code, Ollama, custom)
- Translates between protocols (Augment API format -> OpenAI-compatible, Anthropic API, etc.)
- Handles streaming responses (SSE translation)
- Manages authentication and rate limiting per backend

### 4. MCP Server

Exposes all capabilities as an MCP (Model Context Protocol) server:

- **Tools**: `search_codebase`, `enhance_prompt`, `index_directory`, `ask_codebase`
- **Resources**: Indexed file listings, search results, enhanced prompts
- Compatible with Claude Code, Cursor, Zed, and any MCP-compatible agent

### 5. Claude Code Plugin

A purpose-built integration for Claude Code that:

- Automatically indexes the working directory on startup
- Enhances every prompt with relevant codebase context before sending to Claude
- Provides slash commands for semantic search (`/search`, `/context`, `/enhance`)
- Runs as an MCP server that Claude Code connects to natively

---

## Augment Code SDK Overview

### Official Packages

| Package | Language | Registry |
|---------|----------|----------|
| `@augmentcode/auggie-sdk` | TypeScript | npm |
| `auggie-sdk` | Python | PyPI |
| `@augmentcode/auggie` | CLI (Node.js) | npm |

### SDK Capabilities

**TypeScript SDK** provides two modes:

1. **Agent Interaction (ACP mode)** — Full bidirectional communication via JSON-RPC over stdio
2. **AI SDK Provider** — Vercel AI SDK-compatible model provider for `generateText`/`streamText`

**Python SDK** provides:

- Agent interaction with typed return values
- Function calling support
- Streaming via event listeners
- Automatic type inference from responses

### Authentication

Priority order:
1. Constructor parameters (`apiKey`, `apiUrl`)
2. Environment variables (`AUGMENT_API_TOKEN`, `AUGMENT_API_URL`)
3. Session file (`~/.augment/session.json`, created via `auggie login`)

Retrieve credentials: `auggie token print` outputs `accessToken` and `tenantURL`.

### Context Engine SDK API

| Method | Description |
|--------|-------------|
| `addToIndex(files[])` | Upload and index files (max 1MB per file) |
| `removeFromIndex(paths[])` | Remove files from index |
| `clearIndex()` | Clear all indexed content |
| `getIndexedPaths()` | List all indexed file paths |
| `search(query)` | Semantic search returning formatted results |
| `searchAndAsk(searchQuery, prompt)` | Search + LLM-powered analysis |
| `waitForIndexing()` | Poll until indexing completes |
| `exportToFile(path)` / `importFromFile(path)` | State persistence |

**Constraints**: Max file size 1MB, max search output 80,000 chars (default 20,000), indexing timeout 10 minutes.

---

## Context Engine

### What It Indexes

- Source code (semantic understanding, not just text)
- Commit history and branch-specific changes (Context Lineage)
- Cross-repository dependencies and relationships
- Architectural patterns and coding conventions
- Active vs. deprecated code segments

### How It Works

- **Custom embedding models** trained specifically for code (not generic embeddings)
- **Per-user indices** — separate indices per developer (branch-aware)
- **Real-time updates** — thousands of files per second, near-instant branch switching
- **Proof of Possession** security — IDEs must prove they know file content before retrieval
- **Context curation** — automatic compression and relevance ranking on retrieval

### Infrastructure

Built on Google Cloud: PubSub (messaging), BigTable (storage), AI Hypercomputer (GPU inference). Custom embedding workers on specialized inference stack.

### Performance Impact

Adding the Context Engine improved agent performance by **70%+** across Claude Code, Cursor, and Codex in benchmarks. Reduces 4,456 potential context sources to 682 relevant ones.

---

## Prompt Enhancer

### What It Does

- Takes simple prompts (e.g., "fix the login bug")
- Enriches them with relevant codebase context automatically
- Includes: file paths, function signatures, error handling patterns, test conventions, coding standards
- Uses Context Engine understanding to determine what context is relevant

### Value Proposition

- Better first responses from any LLM (fewer correction cycles)
- Eliminates manual context gathering
- The agent gets the full picture on the first attempt

### Original Implementation

- Activated via `Ctrl+P` in Auggie CLI
- User can review enhanced prompt before sending
- Also available programmatically via Augment Chat

---

## Integration Targets

### Claude Code (Primary)

- MCP server integration via `.claude/settings.json`
- Automatic codebase indexing on session start
- Prompt enhancement on every message
- Slash commands for semantic search

### Ollama (Local Models)

- Route inference to `http://localhost:11434/v1/chat/completions`
- Support any Ollama model (CodeLlama, DeepSeek Coder, Qwen, etc.)
- OpenAI-compatible API translation
- Streaming response support

### Custom Proxy Servers

- Any OpenAI-compatible endpoint
- LiteLLM proxy support
- CCProxy integration
- Custom authentication and routing rules

---

## Proxy Strategies

### Strategy A: Context Engine MCP + External Agent (Recommended Start)

Use the Context Engine MCP server to provide context to any agent, while the agent handles its own inference.

```
[Context Engine MCP] ---> [Claude Code / Any MCP Agent] ---> [Any LLM Backend]
```

**Pros**: Simplest approach, officially supported MCP, no protocol hacking
**Cons**: Doesn't include Prompt Enhancer, requires Augment account for context engine

### Strategy B: SDK Wrapper with Inference Interception

Wrap the Auggie SDK, use Context Engine + Prompt Enhancer, but intercept and redirect inference calls.

```
[Auggie SDK] ---> [Darth Proxy Interceptor] ---> [Ollama / Claude / Custom]
```

**Pros**: Full feature access including Prompt Enhancer
**Cons**: More complex, may break with SDK updates

### Strategy C: Standalone Context + Custom Prompt Enhancement

Build a custom prompt enhancement layer using Context Engine SDK search results, independent of Augment's Prompt Enhancer.

```
[Context Engine SDK] ---> [Custom Prompt Builder] ---> [Any LLM]
```

**Pros**: Most independent, survives SDK changes
**Cons**: Must replicate Prompt Enhancer logic

### Strategy D: ACP Protocol Bridge

Implement ACP (Agent Client Protocol) to act as an Augment-compatible agent that routes to different backends.

```
[Editor via ACP] ---> [Darth Proxy ACP Server] ---> [Context Engine + Local LLM]
```

**Pros**: Works with any ACP-compatible editor (Zed, Neovim, Emacs)
**Cons**: Must implement full ACP JSON-RPC specification

---

## Delivery Formats

### 1. MCP Server (`darth-proxy-mcp`)

```json
{
  "mcpServers": {
    "darth-proxy": {
      "command": "npx",
      "args": ["-y", "darth-proxy", "mcp"],
      "env": {
        "DARTH_PROXY_BACKEND": "ollama",
        "OLLAMA_MODEL": "codellama:34b"
      }
    }
  }
}
```

**Exposed Tools**:
- `search_codebase` — Semantic search across indexed files
- `enhance_prompt` — Enrich a prompt with codebase context
- `index_directory` — Index a directory for semantic search
- `ask_codebase` — Search + AI-powered analysis using your chosen backend

### 2. Claude Code Plugin

Configuration in `.claude/settings.json` pointing to the MCP server. Automatic activation on session start.

### 3. CLI Tool

```bash
# Index current directory
darth-proxy index .

# Semantic search
darth-proxy search "authentication flow"

# Enhance a prompt
darth-proxy enhance "fix the login bug"

# Ask with local inference
darth-proxy ask "How does the payment system work?" --backend ollama --model codellama
```

### 4. REST API

```bash
# Start the proxy server
darth-proxy serve --port 3666

# POST /search
curl -X POST http://localhost:3666/search -d '{"query": "auth flow"}'

# POST /enhance
curl -X POST http://localhost:3666/enhance -d '{"prompt": "fix login bug"}'

# POST /ask (routes to configured backend)
curl -X POST http://localhost:3666/ask -d '{"prompt": "How does payment work?"}'
```

---

## Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Runtime | Node.js / TypeScript | Matches Augment SDK ecosystem |
| SDK | `@augmentcode/auggie-sdk` | Official Context Engine access |
| MCP Framework | `@modelcontextprotocol/sdk` | Standard MCP server implementation |
| HTTP Server | Fastify or Express | REST API and proxy endpoints |
| CLI Framework | Commander.js or yargs | CLI tool interface |
| Proxy Layer | Custom with `node-fetch` / `undici` | Protocol translation |
| Testing | Vitest | Modern, fast test runner |
| Build | tsup or esbuild | Fast TypeScript bundling |
| Package Manager | npm | Widest compatibility |

---

## Project Roadmap

### Phase 1: Foundation

- [ ] Project scaffolding (TypeScript, build tooling, linting)
- [ ] Context Engine adapter wrapping `DirectContext` and `FileSystemContext`
- [ ] Basic semantic search CLI
- [ ] Unit test infrastructure

### Phase 2: Inference Routing

- [ ] Ollama backend (OpenAI-compatible API translation)
- [ ] Claude Code / Anthropic API backend
- [ ] Custom OpenAI-compatible endpoint backend
- [ ] Streaming response translation (SSE)
- [ ] Backend configuration system

### Phase 3: Prompt Enhancement

- [ ] Prompt Enhancer adapter
- [ ] Custom prompt enhancement using Context Engine search results
- [ ] Configurable enhancement templates
- [ ] Enhancement quality metrics

### Phase 4: MCP Server

- [ ] MCP server implementation with standard tools
- [ ] Claude Code integration and testing
- [ ] Tool schemas and documentation
- [ ] Resource exposure (indexed files, search results)

### Phase 5: Delivery & Distribution

- [ ] CLI tool with full command suite
- [ ] REST API server mode
- [ ] npm package publication
- [ ] Claude Code plugin documentation
- [ ] Docker container for self-hosted deployment

### Phase 6: Advanced Features

- [ ] ACP protocol bridge for editor integrations
- [ ] Multi-backend routing (smart routing based on task complexity)
- [ ] Caching layer for repeated context queries
- [ ] Index state persistence across sessions
- [ ] Prompt enhancement analytics and optimization

---

## Related Projects & Prior Art

| Project | Description | Relationship |
|---------|-------------|--------------|
| [augmentcode/auggie](https://github.com/augmentcode/auggie) | Official Augment CLI agent | SDK source |
| [augmentcode/context-engine-plugin](https://github.com/augmentcode/context-engine-plugin) | Official Context Engine MCP | Reference implementation |
| [augmentcode/context-connectors](https://github.com/augmentcode/context-connectors) | Open-source indexing connectors | Potential integration |
| [Kirachon/context-engine](https://github.com/Kirachon/context-engine) | Community MCP for Augment SDK | Community reference |
| [aj47/auggie-context-mcp](https://github.com/aj47/auggie-context-mcp) | Augment Context Engine as MCP | Community reference |
| [CCProxy](https://ccproxy.orchestre.dev) | AI request proxy for Claude Code | Proxy pattern reference |
| [LiteLLM](https://docs.litellm.ai) | Universal LLM proxy | Backend integration |

---

## References

- [Augment Code Official](https://www.augmentcode.com)
- [Augment Code Documentation](https://docs.augmentcode.com)
- [Context Engine Overview](https://www.augmentcode.com/context-engine)
- [Context Engine SDK API Reference](https://docs.augmentcode.com/context-services/sdk/api-reference)
- [Context Engine MCP Documentation](https://docs.augmentcode.com/context-services/mcp/overview)
- [Auggie SDK (TypeScript)](https://docs.augmentcode.com/cli/sdk-typescript)
- [Auggie SDK (Python)](https://docs.augmentcode.com/cli/sdk-python)
- [Prompt Enhancer Documentation](https://docs.augmentcode.com/cli/interactive/prompt-enhancer)
- [Augment Inference Architecture](https://www.augmentcode.com/blog/rethinking-llm-inference-why-developer-ai-needs-a-different-approach)
- [Real-Time Codebase Index](https://www.augmentcode.com/blog/a-real-time-index-for-your-codebase-secure-personal-scalable)
- [MCP Specification](https://modelcontextprotocol.io)
- [Ollama OpenAI Compatibility](https://ollama.com/blog/openai-compatibility)

---

## License

MIT

---

*"I find your lack of free inference disturbing."*
*— Darth Proxy*
