import type { ContextEngine } from './contextEngine.js';
import type { ContextConfig } from '../types/config.types.js';
import { FileIndexer } from './fileIndexer.js';
import { TreeChunker, TextChunker } from './treeChunker.js';
import { SqliteHybridStore } from './sqliteHybridStore.js';
import { LocalContextAdapter } from './localContextAdapter.js';
import type { EmbeddingProvider } from './embedders/embeddingProvider.js';
import { NoopEmbeddingProvider } from './embedders/embeddingProvider.js';
import { OllamaEmbedder } from './embedders/ollamaEmbedder.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type { ContextEngine } from './contextEngine.js';
export { LocalContextAdapter } from './localContextAdapter.js';

function resolvePersistPath(config: ContextConfig): string {
  return config.persistPath ?? join(homedir(), '.darth-proxy', 'index.db');
}

/**
 * Factory that wires up the LocalContextAdapter (offline, zero-dependency inference).
 *
 * Uses SqliteHybridStore — a single SQLite DB with:
 *  - FTS5 virtual table for BM25 full-text search
 *  - sqlite-vec virtual table for ANN vector search
 *  - Single transactional batch inserts for 100× indexing throughput
 *  - No cold-start loadAllChunks() needed (FTS5 persists to disk automatically)
 */
export async function createContextEngine(config: ContextConfig): Promise<ContextEngine> {
  // Embedding provider
  let embedder: EmbeddingProvider;
  if (config.embedder === 'ollama') {
    embedder = new OllamaEmbedder(
      config.ollamaBaseUrl ?? 'http://localhost:11434',
      config.ollamaEmbedModel ?? 'nomic-embed-code',
    );
  } else if (config.embedder === 'transformers') {
    const { TransformersEmbedder } = await import('./embedders/transformersEmbedder.js');
    embedder = new TransformersEmbedder();
  } else {
    embedder = new NoopEmbeddingProvider();
  }

  // Chunker: TreeChunker handles all supported languages (falls back to TextChunker
  // for unsupported ones). TextChunker is used when explicitly configured.
  const chunker = config.chunker === 'text' ? new TextChunker() : new TreeChunker();

  // Hybrid store: single SQLite DB with FTS5 + sqlite-vec
  const store = new SqliteHybridStore(resolvePersistPath(config));
  await store.ensureReady();

  return new LocalContextAdapter(new FileIndexer(), chunker, store, embedder);
}
