import type { ContextEngine } from './contextEngine.js';
import type { ContextConfig } from '../types/config.types.js';
import { FileIndexer } from './fileIndexer.js';
import { getChunker } from './treeChunker.js';
import { OramaIndex } from './oramaIndex.js';
import { SqliteVectorStore } from './sqliteVectorStore.js';
import { MemoryVectorStore } from './memoryVectorStore.js';
import { LocalContextAdapter } from './localContextAdapter.js';
import type { EmbeddingProvider } from './embedders/embeddingProvider.js';
import { NoopEmbeddingProvider } from './embedders/embeddingProvider.js';
import { OllamaEmbedder } from './embedders/ollamaEmbedder.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

export { ContextEngine } from './contextEngine.js';
export { LocalContextAdapter } from './localContextAdapter.js';

function resolvePersistPath(config: ContextConfig): string {
  return config.persistPath ?? join(homedir(), '.darth-proxy', 'index.db');
}

/**
 * Factory that wires up the LocalContextAdapter (offline, zero-dependency inference).
 * BM25 + vector hybrid search, tree-sitter chunking, sqlite-vec storage.
 */
export async function createContextEngine(config: ContextConfig): Promise<ContextEngine> {
  // Embedding provider
  let embedder: EmbeddingProvider;
  if (config.embedder === 'ollama') {
    embedder = new OllamaEmbedder(
      config.ollamaBaseUrl ?? 'http://localhost:11434',
      config.ollamaEmbedModel ?? 'qwen3-embedding',
    );
  } else if (config.embedder === 'transformers') {
    const { TransformersEmbedder } = await import('./embedders/transformersEmbedder.js');
    embedder = new TransformersEmbedder();
  } else {
    embedder = new NoopEmbeddingProvider();
  }

  // Chunker
  const chunker = getChunker(config.chunker === 'text' ? 'unsupported' : 'typescript');

  // Vector store
  const vectorStore =
    config.vectorStore === 'memory'
      ? new MemoryVectorStore()
      : new SqliteVectorStore(resolvePersistPath(config));

  return new LocalContextAdapter(new FileIndexer(), chunker, new OramaIndex(), vectorStore, embedder);
}
