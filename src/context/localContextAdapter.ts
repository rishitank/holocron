import type { ContextEngine } from './contextEngine.js';
import type { SearchResult, IndexResult, IndexOptions, SearchOptions } from '../types/context.types.js';
import type { EmbeddingProvider } from './embedders/embeddingProvider.js';
import type { Chunker } from './treeChunker.js';
import type { FileIndexer } from './fileIndexer.js';
import type { HybridStore } from './hybridStore.js';

/**
 * Reciprocal Rank Fusion constant.
 * Standard empirical value — merges BM25 and vector rankings into a unified score.
 */
const RRF_K = 60;

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
    const chunks = await this._indexFilePaths(filePaths);
    return { indexedFiles: filePaths.length, chunks };
  }

  async indexFiles(filePaths: string[]): Promise<void> {
    await this._indexFilePaths(filePaths);
  }

  async removeFiles(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      await this.store.removeByFilePath(filePath);
    }
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const topK = options?.maxResults ?? 10;

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

    bm25Results.forEach((r, rank) => {
      scoreMap.set(r.id, (scoreMap.get(r.id) ?? 0) + 1 / (RRF_K + rank + 1));
      chunkMap.set(r.id, r.chunk);
    });

    vectorResults.forEach((r, rank) => {
      scoreMap.set(r.id, (scoreMap.get(r.id) ?? 0) + 1 / (RRF_K + rank + 1));
      if (!chunkMap.has(r.id)) chunkMap.set(r.id, r.chunk);
    });

    const merged: SearchResult[] = [];
    for (const [id, score] of scoreMap) {
      const chunk = chunkMap.get(id);
      if (!chunk) continue;
      merged.push({ chunk, score, source: 'hybrid' });
    }

    merged.sort((a, b) => b.score - a.score);
    return merged.slice(0, topK);
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
   *   File I/O and CPU-bound chunking run concurrently, bounded to avoid
   *   file-descriptor exhaustion.
   *
   * Phase 2 — Sequential embedding.
   *   Embedding is typically constrained to one request at a time (Ollama,
   *   local ONNX), so sequential is correct here.
   *
   * Phase 3 — Single transactional addBatch().
   *   All inserts land in one SQLite BEGIN/COMMIT, giving ~100× throughput
   *   vs per-chunk autocommit.
   *
   * @returns Total number of chunks indexed.
   */
  private async _indexFilePaths(filePaths: string[]): Promise<number> {
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
    const entries: Array<{ chunk: (typeof allChunks)[0]; vector: Float32Array }> = [];
    for (const chunk of allChunks) {
      const vector =
        this.embedder.dimensions !== 0
          ? await this.embedder.embed(chunk.content)
          : new Float32Array(0);
      entries.push({ chunk, vector });
    }

    // Phase 3: single transactional batch insert
    await this.store.addBatch(entries);

    return allChunks.length;
  }
}
