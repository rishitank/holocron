import type { Chunk } from '../types/context.types.js';

export interface BM25Hit {
  id: string;
  score: number;
  chunk: Chunk;
}

export interface VectorHit {
  id: string;
  score: number;
  chunk: Chunk;
}

export interface BatchEntry {
  chunk: Chunk;
  vector: Float32Array;
}

/**
 * HybridStore: single-DB store combining BM25 (FTS5) + ANN (sqlite-vec).
 * Implementations must expose both search modalities and atomic batch writes.
 */
export interface HybridStore {
  /** Ensure internal async initialization (e.g. dynamic imports) is complete. */
  ensureReady(): Promise<void>;

  /**
   * Atomically index a batch of chunks + optional vectors.
   * Wraps inserts in a single SQLite transaction for 100× throughput.
   */
  addBatch(entries: BatchEntry[]): Promise<void>;

  /** BM25 full-text search via FTS5. Returns ranked hits. */
  searchBM25(query: string, topK: number): Promise<BM25Hit[]>;

  /** ANN vector search. Returns hits ranked by cosine similarity. */
  searchVector(queryVec: Float32Array, topK: number): Promise<VectorHit[]>;

  /** Remove all chunks belonging to a given file path. */
  removeByFilePath(filePath: string): Promise<void>;

  /** Empty all tables and reset vector dimensions. */
  clearAll(): Promise<void>;

  /** Close the underlying database connection. */
  close(): void;

  /** Number of indexed chunks. */
  readonly size: number;

  /** True when at least one vector has been indexed (dimensions > 0). */
  readonly hasVectors: boolean;
}
