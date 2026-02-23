import type { Chunk } from '../types/context.types.js';

export type MemoryType = 'semantic' | 'procedural';

export interface BM25Hit {
  id: string;
  score: number;
  chunk: Chunk;
  ingestedAt: number;   // epoch ms when chunk was indexed
  memoryType: MemoryType;
}

export interface VectorHit {
  id: string;
  score: number;
  chunk: Chunk;
  ingestedAt: number;   // epoch ms when chunk was indexed
  memoryType: MemoryType;
}

export interface BatchEntry {
  chunk: Chunk;
  vector: Float32Array;
  memoryType?: MemoryType; // defaults to 'semantic'
}

/** A similarity edge between two chunks (used for graph-hop expansion). */
export interface ChunkLink {
  srcId: string;
  dstId: string;
  similarity: number; // [0, 1]
}

/** Metadata from a chunk_meta row, returned by getChunkById(). */
export interface ChunkMeta {
  chunk: Chunk;
  ingestedAt: number;
  memoryType: MemoryType;
}

/** Indexing operation audit record written to index_events. */
export interface IndexEvent {
  eventType: 'full' | 'incremental' | 'files';
  filesChanged: number;
  chunksAdded: number;
  chunksRemoved: number;
  commitSha?: string;
}

/**
 * HybridStore: single-DB store combining BM25 (FTS5) + ANN (sqlite-vec).
 * Implementations must expose both search modalities and atomic batch writes.
 *
 * v3 additions (Engram + Context Graph research):
 * - ingestedAt / memoryType per chunk for recency decay + type weighting
 * - chunk_links table for post-hoc similarity graph expansion
 * - index_events audit log for reified indexing decisions
 */
export interface HybridStore {
  /** Ensure internal async initialization (e.g. dynamic imports) is complete. */
  ensureReady(): Promise<void>;

  /**
   * Atomically index a batch of chunks + optional vectors.
   * Wraps inserts in a single SQLite transaction for 100× throughput.
   */
  addBatch(entries: BatchEntry[]): Promise<void>;

  /** BM25 full-text search via FTS5. Returns ranked hits with temporal metadata. */
  searchBM25(query: string, topK: number): Promise<BM25Hit[]>;

  /** ANN vector search. Returns hits ranked by cosine similarity with temporal metadata. */
  searchVector(queryVec: Float32Array, topK: number): Promise<VectorHit[]>;

  /** Fetch a single chunk by its ID, with temporal metadata. Returns null if not found. */
  getChunkById(id: string): Promise<ChunkMeta | null>;

  /** Write similarity links between chunks (upserts on PRIMARY KEY conflict). */
  addLinks(links: ChunkLink[]): Promise<void>;

  /**
   * Retrieve similarity links originating from a chunk.
   * @param limit Max links to return (default: 5)
   */
  getLinks(srcId: string, limit?: number): Promise<ChunkLink[]>;

  /** Append an audit record for an indexing operation. */
  logIndexEvent(event: IndexEvent): Promise<void>;

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
