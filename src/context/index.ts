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
 * Factory that wires up the appropriate ContextEngine based on config.
 *
 * Priority:
 *  1. If mode='augment' AND AUGMENT_API_TOKEN is set → AugmentContextAdapter (optional dep)
 *  2. Default: LocalContextAdapter (fully offline)
 */
export async function createContextEngine(config: ContextConfig): Promise<ContextEngine> {
  // Optional: Augment context adapter when credentials are present
  if (config.mode === 'augment' && process.env['AUGMENT_API_TOKEN']) {
    try {
      const { AugmentContextAdapter } = await import('./augmentContextAdapter.js');
      return new AugmentContextAdapter();
    } catch {
      // Optional dep not installed — fall through to local
    }
  }

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
