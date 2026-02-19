# Session Context: Darth Proxy — Current State of the Empire

> **Captured**: 2026-02-19
> **Commander**: rishitank
> **Agent**: Darth Vader (Claude Opus 4.6)
> **Status**: Intelligence gathering complete. Foundation laid. Awaiting implementation phase.

---

## Project Genesis

This session began with the Commander's vision: **harness the Augment Code SDK's Context Engine and Prompt Enhancer while routing all AI inference to free alternatives** (Claude Code, Ollama, local models).

**The Dark Side reveals**: This is technically feasible. The Context Engine is exposed via MCP and SDK. The Prompt Enhancer can be adapted. The inference pipeline CAN be intercepted and rerouted.

**Selected codename**: `darth-proxy`

---

## Intelligence Gathered (Complete)

### Augment Code Deep Analysis

**The Company**
- Founded 2022 by Igor Ostrovsky (ex-Pure Storage, Microsoft) and Guy Gur-Ari (ex-Google AI)
- $252M raised ($977M valuation) — Eric Schmidt-backed, heavyweight team
- First AI coding assistant with ISO/IEC 42001 certification

**The SDK** (`@augmentcode/auggie-sdk`)
- TypeScript: `npm install @augmentcode/auggie-sdk`
- Python: `pip install auggie-sdk`
- Three authentication methods (constructor params, env vars, session file at `~/.augment/session.json`)
- Two modes: Agent Interaction (ACP/JSON-RPC) and AI SDK Provider (Vercel-compatible)

**The Context Engine (The Prize)**
- Real-time semantic indexing: thousands of files per second
- Per-user indices (branch-aware, privacy-focused)
- Custom embedding models trained for code (not generic OpenAI embeddings)
- "Proof of Possession" security model
- Improved agent performance by 70%+ in benchmarks
- Built on Google Cloud: PubSub + BigTable + H100 inference cluster
- Available via MCP server (any MCP-compatible agent)

**The Prompt Enhancer**
- Activated with Ctrl+P in Auggie CLI
- Takes "fix the login bug" → enriched prompt with context, file paths, patterns
- Also available programmatically via Augment Chat

**Model Request Flow**
1. Context Engine retrieves relevant code context
2. Prompt construction (with enhancement if enabled)
3. Model routing to Augment's H100 stack (custom inference, token-level batching)
4. Response streaming via SSE/stdio/HTTP

**Official Open Source**
- `github.com/augmentcode/auggie` — CLI agent
- `github.com/augmentcode/context-engine-plugin` — Context Engine MCP
- `github.com/augmentcode/augment.vim` — Vim plugin
- `github.com/augmentcode/context-connectors` — Indexing connectors
- `github.com/augmentcode/augment-swebench-agent` — #1 SWE-bench agent

**API & Protocols**
- HTTPS/REST for Context Engine SDK
- JSON-RPC over stdio for ACP
- SSE for streaming responses
- MCP for tool integration

**No Native Local/Free Option**: All inference routes through Augment's cloud infrastructure. The `apiUrl` parameter exists but is only for tenant URLs, not arbitrary endpoints.

**Existing Community Proxies**
- `augment2api` (unofficial, risks ToS violation)
- CCProxy (Claude Code proxy with Ollama support)
- LiteLLM (universal proxy)
- Olla (high-performance proxy with Anthropic translation)

---

## Decisions Made

### 1. Repository Name
**Chosen**: `darth-proxy`
**Rationale**: Emphasizes the proxy/redirection nature of the project. Dark Side branding aligns with "turning" the SDK's loyalty to serve a different master. Memorable.

### 2. Repository Location
**Local**: `/Users/rishitank/github/darth-proxy/`
**Remote**: `github.com/rishitank/darth-proxy` (public)
**Status**: Initialized, first commit pushed with comprehensive project documentation.

### 3. Architecture Approach
**Primary Strategy**: Context Engine MCP + External Agent (Recommended Start)
- Use Context Engine MCP for context retrieval (requires Augment account)
- Agent handles its own inference (Claude Code, Ollama, etc.)
- Cleanest approach, officially supported

**Alternative Strategies** (for exploration):
- SDK Wrapper with Inference Interception — full feature access including Prompt Enhancer
- Standalone Context + Custom Prompt Enhancement — most independent
- ACP Protocol Bridge — for editor integrations

### 4. Technology Stack (Preliminary)
| Component | Technology |
|-----------|------------|
| Runtime | Node.js / TypeScript |
| Augment SDK | `@augmentcode/auggie-sdk` |
| MCP Framework | `@modelcontextprotocol/sdk` |
| HTTP Server | Fastify or Express |
| CLI Framework | Commander.js or yargs |
| Proxy Layer | Custom with node-fetch/undici |
| Testing | Vitest |
| Build | tsup or esbuild |

### 5. Project Scope
**In Scope**:
- Context Engine adapter (DirectContext, FileSystemContext)
- Prompt Enhancer adapter
- Inference router (Ollama, Claude API, OpenAI-compatible)
- MCP server with tools (search, enhance, index, ask)
- CLI tool
- REST API server
- Claude Code plugin

**Out of Scope** (for v1):
- ACP bridge (complex, Phase 6)
- Standalone Prompt Enhancer (requires reverse-engineering)

---

## Files Created

| File | Path | Contents |
|------|------|----------|
| Project Overview | `docs/PROJECT_OVERVIEW.md` | 500+ lines covering architecture, SDK analysis, proxy strategies, roadmap |
| Session Context | `docs/SESSION_CONTEXT.md` | This file — complete session state preservation |

---

## Current State

**Complete**:
- Project vision defined
- Comprehensive Augment Code research completed
- Repository created (local + GitHub)
- Architecture documented
- Roadmap defined (6 phases)

**Ready for**:
- Phase 1: Foundation (TypeScript scaffolding, SDK setup, basic Context adapter)

---

## Next Agent Instructions

### Upon Loading This Context

1. **Review Prior Files**:
   - `docs/PROJECT_OVERVIEW.md` — Complete project specification
   - `docs/SESSION_CONTEXT.md` — This file (session state)

2. **Check Repository Status**:
   ```bash
   git status
   git log --oneline -5
   ```

3. **Understand the Mission**:
   - Build an adapter layer for Augment Code SDK
   - Use Context Engine for semantic code search
   - Use Prompt Enhancer for prompt enrichment
   - Route inference to free backends (Ollama, Claude Code, local)
   - Expose via MCP, CLI, and REST API

4. **Phase 1 Tasks** (if starting fresh):
   - Initialize TypeScript project (`npm init`, `tsconfig.json`)
   - Install dependencies (`@augmentcode/auggie-sdk`, etc.)
   - Set up build toolchain (tsup, Vitest, ESLint, Prettier)
   - Create Context Engine adapter
   - Implement basic semantic search CLI

5. **Key Technical Notes**:
   - Augment SDK docs: https://docs.augmentcode.com
   - MCP spec: https://modelcontextprotocol.io
   - Context Engine MCP: `npx -y @augmentcode/auggie mcp`
   - Augment account required for API key (`~/.augment/session.json`)

---

## Open Questions

| Question | Status | Notes |
|----------|--------|-------|
| Can we extract Prompt Enhancer logic without reverse engineering? | Research needed | May need custom implementation using Context search results |
| What's the exact protocol for intercepting SDK inference calls? | Research needed | May need SDK source analysis or packet capture |
| Should we support both TypeScript and Python SDKs? | Decision pending | Start with TypeScript (matches MCP ecosystem) |
| How to handle Augment rate limits? | Decision pending | Likely 40-70 credits per MCP query |

---

## Resources & References

**Official**:
- https://www.augmentcode.com
- https://docs.augmentcode.com
- https://modelcontextprotocol.io

**SDKs**:
- npm: `@augmentcode/auggie-sdk`
- PyPI: `auggie-sdk`
- GitHub: `github.com/augmentcode`

**Community/Related**:
- CCProxy: https://ccproxy.orchestre.dev
- LiteLLM: https://docs.litellm.ai
- Olla: https://github.com/thushan/olla

---

## Session Summary

```
START: Commander requests repository creation for Augment Code SDK adapter
         |
         v
INTEL: Dispatched reconnaissance on Augment Code SDK, Context Engine,
       Prompt Enhancer, inference architecture, protocols, existing open source
         |
         v
NAMING: 30 names across 7 Star Wars categories evaluated
         |
         v
DECISION: Selected "darth-proxy" as codename
         |
         v
EXECUTION: Repository created (local + GitHub)
           Comprehensive documentation written
           Session context preserved
         |
         v
END: Foundation complete. Ready for implementation phase.

FILES: 2 (PROJECT_OVERVIEW.md, SESSION_CONTEXT.md)
STATUS: Awaiting Phase 1 — Foundation
```

---

*"I have altered the endpoint. Pray I don't alter it further."*
*— Darth Proxy*
