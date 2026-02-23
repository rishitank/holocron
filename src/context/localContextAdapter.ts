import type { ContextEngine } from './contextEngine.js';
import type { SearchResult, IndexResult, IndexOptions, SearchOptions } from '../types/context.types.js';
import type { EmbeddingProvider } from './embedders/embeddingProvider.js';
import type { Chunker } from './treeChunker.js';
import type { FileIndexer } from './fileIndexer.js';
import type { HybridStore, ChunkLink } from './hybridStore.js';
import { buildContextualContent } from './tokenizer.js';
import { classifyMemoryType } from './memoryClassifier.js';

/**
 * Reciprocal Rank Fusion constant.
 * Standard empirical value — merges BM25 and vector rankings into a unified score.
 */
const RRF_K = 60;

/**
 * Recency decay constants (Ebbinghaus-inspired, from Engram research).
 * Chunks in files that haven't been touched recently score slightly lower.
 *
 * DECAY_BASE^(age_months) applied to RRF score.
 * - After 1 month:  0.95
 * - After 6 months: 0.74
 * - After 1 year:   0.54  → floored at DECAY_FLOOR
 *
 * The decay is intentionally soft — old but important code should not be suppressed.
 */
const DECAY_BASE = 0.95;
const DECAY_FLOOR = 0.5;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Score multipliers by memory type (Context Graph research).
 * Procedural files (configs, build scripts) are less likely to be the direct
 * answer to a code query — weight them down slightly.
 */
const MEMORY_TYPE_WEIGHT: Record<string, number> = {
  semantic: 1.0,
  procedural: 0.8,
};

/**
 * Minimum similarity threshold for graph-hop link expansion.
 * Only high-confidence similarity edges are traversed.
 */
const LINK_EXPANSION_THRESHOLD = 0.9;

/**
 * Bounded concurrency primitive — limits parallel file I/O to avoid
 * file-descriptor exhaustion on large repositories.
 */
class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      if (this.running < this.limit) {
        this.running++;
        resolve();
      } else {
        this.queue.push(() => {
          this.running++;
          resolve();
        });
      }
    });
    try {
      return await fn();
    } finally {
      this.running--;
      this.queue.shift()?.();
    }
  }
}

/** Max parallel file reads + chunks in flight at once. */
const IO_CONCURRENCY = 16;

export class LocalContextAdapter implements ContextEngine {
  constructor(
    private readonly fileIndexer: FileIndexer,
    private readonly chunker: Chunker,
    private readonly store: HybridStore,
    private readonly embedder: EmbeddingProvider,
  ) {}

  async indexDirectory(dirPath: string, _options?: IndexOptions): Promise<IndexResult> {
    const filePaths: string[] = [];
    for await (const entry of this.fileIndexer.walkDirectory(dirPath)) {
      filePaths.push(entry.path);
    }
    const chunks = await this._indexFilePaths(filePaths, 'full');
    return { indexedFiles: filePaths.length, chunks };
  }

  async indexFiles(filePaths: string[]): Promise<void> {
    await this._indexFilePaths(filePaths, 'incremental');
  }

  async removeFiles(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      await this.store.removeByFilePath(filePath);
    }
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const topK = options?.maxResults ?? 10;
    const now = Date.now();

    // BM25 full-text search (FTS5 — always up-to-date, no cold-start needed)
    const bm25Results = await this.store.searchBM25(query, topK * 2);

    // Vector ANN search (skipped when embedder is noop)
    const vectorResults =
      this.embedder.dimensions > 0
        ? await this.store.searchVector(await this.embedder.embed(query), topK * 2)
        : [];

    // Reciprocal Rank Fusion — items in both rankings score higher
    const scoreMap = new Map<string, number>();
    const chunkMap = new Map<string, (typeof bm25Results)[0]['chunk']>();
    const ingestedAtMap = new Map<string, number>();
    const memTypeMap = new Map<string, string>();

    bm25Results.forEach((r, rank) => {
      scoreMap.set(r.id, (scoreMap.get(r.id) ?? 0) + 1 / (RRF_K + rank + 1));
      chunkMap.set(r.id, r.chunk);
      ingestedAtMap.set(r.id, r.ingestedAt);
      memTypeMap.set(r.id, r.memoryType);
    });

    vectorResults.forEach((r, rank) => {
      scoreMap.set(r.id, (scoreMap.get(r.id) ?? 0) + 1 / (RRF_K + rank + 1));
      if (!chunkMap.has(r.id)) {
        chunkMap.set(r.id, r.chunk);
        ingestedAtMap.set(r.id, r.ingestedAt);
        memTypeMap.set(r.id, r.memoryType);
      }
    });

    // Build merged results with recency decay + memory type weighting
    const merged: SearchResult[] = [];
    for (const [id, rrfScore] of scoreMap) {
      const chunk = chunkMap.get(id);
      if (!chunk) continue;

      // Ebbinghaus recency decay (Engram research)
      // Chunks ingested recently preserve full score; older chunks decay softly
      const ingestedAt = ingestedAtMap.get(id) ?? now;
      const ageMonths = (now - ingestedAt) / THIRTY_DAYS_MS;
      const decay = Math.max(DECAY_FLOOR, Math.pow(DECAY_BASE, ageMonths));

      // Memory type weight (Context Graph research)
      const memType = memTypeMap.get(id) ?? 'semantic';
      const typeWeight = MEMORY_TYPE_WEIGHT[memType] ?? 1.0;

      merged.push({ chunk, score: rrfScore * decay * typeWeight, source: 'hybrid' });
    }

    merged.sort((a, b) => b.score - a.score);
    const topResults = merged.slice(0, topK);

    // Graph-hop expansion (A-MEM bidirectional linking)
    // For each top result with existing similarity links, fetch linked chunks
    // and add them with discounted scores if not already present.
    if (this.store.hasVectors && topResults.length > 0) {
      const expandedIds = new Set(scoreMap.keys());
      const expansions: SearchResult[] = [];

      for (const result of topResults.slice(0, 5)) {
        const links = await this.store.getLinks(result.chunk.id, 3);
        for (const link of links) {
          if (link.similarity < LINK_EXPANSION_THRESHOLD) continue;
          if (expandedIds.has(link.dstId)) continue;
          expandedIds.add(link.dstId);

          const meta = await this.store.getChunkById(link.dstId);
          if (!meta) continue;

          const ageMonths = (now - meta.ingestedAt) / THIRTY_DAYS_MS;
          const decay = Math.max(DECAY_FLOOR, Math.pow(DECAY_BASE, ageMonths));
          const typeWeight = MEMORY_TYPE_WEIGHT[meta.memoryType] ?? 1.0;
          // Discount: 50% of parent score × similarity × decay
          const expandedScore = result.score * 0.5 * link.similarity * decay * typeWeight;

          expansions.push({ chunk: meta.chunk, score: expandedScore, source: 'hybrid' });
        }
      }

      if (expansions.length > 0) {
        topResults.push(...expansions);
        topResults.sort((a, b) => b.score - a.score);
        return topResults.slice(0, topK);
      }
    }

    return topResults;
  }

  /**
   * Build post-hoc similarity links between chunks with vectors.
   *
   * Inspired by A-MEM (NeurIPS 2025, arXiv 2502.12110): after indexing, build
   * a lightweight graph of high-similarity chunk pairs. At search time, top-k
   * results are expanded by following links, surfacing semantically related
   * chunks that BM25+vector may have missed.
   *
   * @param minSimilarity Minimum cosine-proxy threshold (default 0.85)
   * @param topK Neighbours per chunk to consider (default 5)
   * @returns Number of new links created
   */
  async buildChunkLinks(options: { minSimilarity?: number; topK?: number } = {}): Promise<{
    linksCreated: number;
  }> {
    if (!this.store.hasVectors) return { linksCreated: 0 };

    const minSim = options.minSimilarity ?? 0.85;
    const topK = options.topK ?? 5;

    // We need all chunk IDs with vectors — fetch via a BM25 wildcard-ish approach.
    // In practice the caller should pass a corpus to process; here we scan by
    // issuing a broad BM25 search to get a representative sample.
    // For a full scan, the store would need a cursor API — deferred.
    // Current implementation: build links for recently-searched chunks on demand.
    // TODO: add HybridStore.scanAllChunkIds() for full corpus linking.
    return { linksCreated: 0 };
  }

  async clearIndex(): Promise<void> {
    await this.store.clearAll();
  }

  async dispose(): Promise<void> {
    this.store.close();
  }

  // ── private ──────────────────────────────────────────────────────────────

  /**
   * Index a list of file paths using a two-phase strategy:
   *
   * Phase 1 — Parallel file read + chunk (IO_CONCURRENCY workers).
   * Phase 2 — Sequential embedding using contextual content prefix.
   * Phase 3 — Single transactional addBatch().
   * Phase 4 — Log index event to audit trail (reified decision).
   *
   * @returns Total number of chunks indexed.
   */
  private async _indexFilePaths(
    filePaths: string[],
    eventType: 'full' | 'incremental' | 'files',
  ): Promise<number> {
    if (filePaths.length === 0) return 0;

    // Remove stale chunks for all files being re-indexed
    for (const filePath of filePaths) {
      await this.store.removeByFilePath(filePath);
    }

    // Phase 1: parallel read + chunk
    const sem = new Semaphore(IO_CONCURRENCY);
    const perFileChunks = await Promise.all(
      filePaths.map((filePath) =>
        sem.run(async () => {
          const entry = await this.fileIndexer.readFile(filePath);
          if (!entry) return [];
          return this.chunker.chunk({
            path: entry.path,
            contents: entry.contents,
            language: entry.language,
          });
        }),
      ),
    );

    const allChunks = perFileChunks.flat();
    if (allChunks.length === 0) return 0;

    // Phase 2: sequential embedding
    // Use contextual content (file + language + symbol prefix) for embedding only —
    // the enriched text is never stored; original chunk.content is persisted.
    const entries: Array<{ chunk: (typeof allChunks)[0]; vector: Float32Array; memoryType: 'semantic' | 'procedural' }> = [];
    for (const chunk of allChunks) {
      const vector =
        this.embedder.dimensions !== 0
          ? await this.embedder.embed(buildContextualContent(chunk))
          : new Float32Array(0);
      const memoryType = classifyMemoryType(chunk.filePath);
      entries.push({ chunk, vector, memoryType });
    }

    // Phase 3: single transactional batch insert
    await this.store.addBatch(entries);

    // Phase 4: reified indexing decision — audit trail (Context Graph provenance)
    await this.store.logIndexEvent({
      eventType,
      filesChanged: filePaths.length,
      chunksAdded: allChunks.length,
      chunksRemoved: 0, // exact count requires per-file size delta; 0 is an acceptable audit approximation
    });

    return allChunks.length;
  }
}
