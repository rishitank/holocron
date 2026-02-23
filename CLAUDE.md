# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                    # Run all tests (vitest)
npm run typecheck           # tsc --noEmit (zero errors required)
npm run build               # tsup (outputs dist/)
npm run lint                # eslint src tests
npm run test:coverage       # vitest with v8 coverage (80% line/fn/stmt threshold)
npm run benchmark           # Run retrieval quality benchmark against the local corpus
```

To run a single test file:
```bash
npx vitest run tests/unit/context/sqliteHybridStore.test.ts
```

To run tests matching a name pattern:
```bash
npx vitest run --reporter=verbose -t "searchBM25"
```

## Architecture

### Data Flow

Every Claude Code prompt is intercepted by the `UserPromptSubmit` hook. The hook runs `holocron hook user-prompt-submit`, which:
1. Reads the prompt JSON from stdin (5-second timeout)
2. Calls `engine.search(prompt)` → returns `SearchResult[]`
3. Formats results via `contextFormatter` → `<codebase_context>` XML
4. Writes `{ additionalContext: "..." }` to stdout

### Core Abstractions

**`ContextEngine` interface** (`src/context/contextEngine.ts`) — the single seam all callers depend on. `LocalContextAdapter` is the only production implementation. Adding a new backend (e.g. cloud) means implementing this interface with no other changes.

**`HybridStore` interface** (`src/context/hybridStore.ts`) — `LocalContextAdapter` depends on this, not the concrete class. `SqliteHybridStore` implements it.

**`InferenceBackend` interface** (`src/backends/inferenceBackend.ts`) — implemented by `OllamaBackend`, `AnthropicBackend`, `OpenAICompatibleBackend`.

**`EmbeddingProvider` interface** (`src/context/embedders/embeddingProvider.ts`) — `OllamaEmbedder`, `TransformersEmbedder`, `NoopEmbeddingProvider`.

### Context Engine Internals

`LocalContextAdapter` (`src/context/localContextAdapter.ts`) orchestrates a three-phase indexing pipeline:
1. **Phase 1**: Parallel file read + chunk with `Semaphore(16)` — bounded I/O concurrency
2. **Phase 2**: Sequential embedding (Ollama/Transformers are single-threaded by nature)
3. **Phase 3**: Single `BEGIN/COMMIT` transaction via `store.addBatch()` — ~100× throughput vs per-chunk autocommit

Search is BM25 + vector RRF (`RRF_K = 60`). Vector search is skipped when `embedder.dimensions === 0` (noop/BM25-only mode).

`SqliteHybridStore` (`src/context/sqliteHybridStore.ts`) uses a single SQLite file with:
- `chunk_meta` — source-of-truth rows, rowids shared across virtual tables
- `chunks_fts` — FTS5 virtual table with `porter unicode61` tokenizer; columns: `content`, `symbol_name`, `file_tokens` (camelCase-split basename for path-based lookup)
- `vecs` — `sqlite-vec` vec0 virtual table (created lazily on first embedding, dimension-locked)
- `_meta` — persists vector dimension so it survives process restart

**FTS5 tokenizer note**: `unicode61` does NOT split camelCase. `searchBM25` and `GitTracker` are single tokens. `file_tokens` column partially mitigates this by indexing the split basename.

`TreeChunker` uses regex patterns per language (not tree-sitter) to split at function/class/method boundaries with 50-line overlap. Supports: TypeScript, JavaScript, Python, Go, Rust, Java, Ruby, C#. Falls back to sliding-window `TextChunker` for unsupported languages.

`GitTracker` (`src/context/gitTracker.ts`) stores the last-indexed HEAD SHA in `.holocron-last-sha`. On `checkFreshness()`: returns `none` (<1ms) if SHA unchanged, `incremental` with a `ChangedFiles` diff if commits landed, or `full` on any error/first-run.

### Configuration Chain

Priority: **CLI flags → env vars → `.holocron.json` → defaults**

`loadConfig()` (`src/config/loader.ts`) merges these layers. Key env vars: `DARTH_EMBEDDER`, `DARTH_PERSIST_PATH`, `ANTHROPIC_API_KEY`, `OLLAMA_BASE_URL`, `DARTH_PROXY_PORT`.

### Build Notes

`tsup.config.ts` has a post-build patch: esbuild strips `node:` prefix from `import('node:sqlite')` → `import('sqlite')`, which is not a valid Node.js built-in. The `onSuccess` hook restores the prefix in the dist files.

`node:sqlite` is Node.js 25's built-in synchronous SQLite (`DatabaseSync`). All calls are synchronous; `SqliteHybridStore` wraps them in an async `init()` promise so callers can `await ensureReady()`.

### Test Structure

```
tests/
  unit/          # Vitest unit tests with mocked deps (no real I/O)
  integration/   # Integration tests (real SQLite, real file system)
  benchmark/     # Retrieval quality harness (not part of `npm test`)
  fixtures/      # Shared test data
```

Mocking pattern: tests receive interface types (`HybridStore`, `EmbeddingProvider`, etc.) and construct plain objects with `vi.fn()` mocks — no class extension needed because all deps are injected by constructor.

The benchmark runner (`tests/benchmark/runner.ts`) indexes the holocron repo itself as the corpus. Run with `npm run benchmark -- --no-coldstart` to skip cold-start timing. Uses `tsx` (not `node --experimental-strip-types`) because Node's strip-types mode does not remap `.js` → `.ts` imports.
