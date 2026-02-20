/**
 * Ground-truth query set for darth-proxy retrieval benchmarking.
 *
 * The corpus is the darth-proxy codebase itself (~82 TypeScript files).
 * Each entry maps a natural-language query to the file(s) expected to rank
 * in the top results. Recall@K and MRR are computed against these lists.
 */

export interface BenchmarkQuery {
  readonly q: string;
  readonly files: readonly string[];
}

export const QUERIES: readonly BenchmarkQuery[] = [
  // ── Conceptual / semantic queries ─────────────────────────────────────────
  {
    q: 'BM25 full-text search indexing',
    files: ['src/context/sqliteHybridStore.ts'],
  },
  {
    q: 'vector similarity cosine embeddings sqlite-vec',
    files: ['src/context/sqliteHybridStore.ts'],
  },
  {
    q: 'git incremental reindex changed files',
    files: ['src/context/gitTracker.ts'],
  },
  {
    q: 'AST chunking function class boundaries',
    files: ['src/context/treeChunker.ts'],
  },
  {
    q: 'inject context into user prompt hook',
    files: ['src/cli/commands/hook.ts'],
  },
  {
    q: 'Ollama embed model REST API call',
    files: ['src/context/embedders/ollamaEmbedder.ts'],
  },
  {
    q: 'MCP server tool resource prompt registration',
    files: ['src/mcp/server.ts'],
  },
  {
    q: 'install claude code settings json hook',
    files: ['src/cli/commands/pluginInstall.ts'],
  },
  {
    q: 'Anthropic API messages system role',
    files: ['src/backends/anthropicBackend.ts'],
  },
  {
    q: 'config load environment variables override',
    files: ['src/config/loader.ts', 'src/config/defaults.ts'],
  },
  // ── Lexical / specific queries ────────────────────────────────────────────
  {
    q: 'ReciprocRankFusion RRF k=60 score merge',
    files: ['src/context/localContextAdapter.ts'],
  },
  {
    q: 'DatabaseSync sqlite-vec allowExtension load vector extension',
    files: ['src/context/sqliteHybridStore.ts'],
  },
  {
    q: 'codebase_context XML format rank file lines',
    files: ['src/enhancers/contextFormatter.ts'],
  },
  // ── Cross-cutting queries ─────────────────────────────────────────────────
  {
    q: 'file walker skip binaries node_modules 1MB',
    files: ['src/context/fileIndexer.ts'],
  },
  {
    q: 'streaming SSE inference chunk done signal',
    files: ['src/backends/ollamaBackend.ts', 'src/backends/openaiCompatibleBackend.ts'],
  },
] as const;
