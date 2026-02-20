import type { ContextEngine } from './contextEngine.js';
import type { SearchResult, IndexResult, IndexOptions, SearchOptions } from '../types/context.types.js';
import type { VectorStore } from './vectorStore.js';
import type { EmbeddingProvider } from './embedders/embeddingProvider.js';
import type { Chunker } from './treeChunker.js';
import type { FileIndexer } from './fileIndexer.js';
import type { OramaIndex } from './oramaIndex.js';
import type { SqliteVectorStore } from './sqliteVectorStore.js';

/**
 * Reciprocal Rank Fusion constant.
 * Standard empirical value — merges BM25 and vector rankings.
 */
const RRF_K = 60;

export class LocalContextAdapter implements ContextEngine {
  /** True once BM25 index has been populated in this process lifetime. */
  private bm25Loaded = false;

  constructor(
    private readonly fileIndexer: FileIndexer,
    private readonly chunker: Chunker,
    private readonly oramaIndex: OramaIndex,
    private readonly vectorStore: VectorStore,
    private readonly embedder: EmbeddingProvider,
  ) {}

  async indexDirectory(dirPath: string, _options?: IndexOptions): Promise<IndexResult> {
    const filePaths: string[] = [];
    for await (const entry of this.fileIndexer.walkDirectory(dirPath)) {
      filePaths.push(entry.path);
    }
    await this._indexFilePaths(filePaths);
    return { indexedFiles: filePaths.length, chunks: 0 /* approximate */ };
  }

  async indexFiles(filePaths: string[]): Promise<void> {
    await this._indexFilePaths(filePaths);
  }

  async removeFiles(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      await this.oramaIndex.removeByFilePath(filePath);
      // Vector store entries use chunk IDs — we can't enumerate them here easily,
      // so this is a best-effort removal via the BM25 index.
    }
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const topK = options?.maxResults ?? 10;

    // Restore BM25 index from persistent storage on cold start (separate process invocation)
    await this._ensureBm25Loaded();

    // BM25 search
    const bm25Results = await this.oramaIndex.search(query, topK * 2);

    // Vector search (skip if embedder is noop)
    let vectorResults: Array<{ id: string; score: number; metadata: Record<string, string> }> = [];
    if (this.embedder.dimensions > 0) {
      const queryVec = await this.embedder.embed(query);
      vectorResults = await this.vectorStore.search(queryVec, topK * 2);
    }

    // Reciprocal Rank Fusion
    const scoreMap = new Map<string, number>();

    bm25Results.forEach((r, rank) => {
      const prev = scoreMap.get(r.chunk.id) ?? 0;
      scoreMap.set(r.chunk.id, prev + 1 / (RRF_K + rank + 1));
    });

    vectorResults.forEach((r, rank) => {
      const prev = scoreMap.get(r.id) ?? 0;
      scoreMap.set(r.id, prev + 1 / (RRF_K + rank + 1));
    });

    // Build final result list sorted by RRF score
    const allIds = new Set([
      ...bm25Results.map((r) => r.chunk.id),
      ...vectorResults.map((r) => r.id),
    ]);

    const chunkMap = new Map(bm25Results.map((r) => [r.chunk.id, r.chunk]));

    // Enrich with vector result metadata for IDs only in vector results
    for (const r of vectorResults) {
      if (!chunkMap.has(r.id)) {
        // Minimal chunk from metadata
        chunkMap.set(r.id, {
          id: r.id,
          content: '',
          filePath: r.metadata['filePath'] ?? '',
          startLine: Number(r.metadata['startLine'] ?? 0),
          endLine: Number(r.metadata['endLine'] ?? 0),
          language: r.metadata['language'] ?? 'text',
          ...(r.metadata['symbolName'] !== undefined && { symbolName: r.metadata['symbolName'] }),
        });
      }
    }

    const merged: SearchResult[] = [];
    for (const id of allIds) {
      const chunk = chunkMap.get(id);
      if (!chunk) continue;
      merged.push({
        chunk,
        score: scoreMap.get(id) ?? 0,
        source: 'hybrid',
      });
    }

    merged.sort((a, b) => b.score - a.score);
    return merged.slice(0, topK);
  }

  async clearIndex(): Promise<void> {
    await this.oramaIndex.clear();
    await this.vectorStore.clear();
  }

  async dispose(): Promise<void> {
    await this.vectorStore.close();
  }

  // ── private ──────────────────────────────────────────────────────────────

  /**
   * Restore BM25 index from persisted SQLite data on cold start.
   * This allows the hook and CLI search commands to find results even when
   * running in a fresh process that has never called indexDirectory().
   */
  private async _ensureBm25Loaded(): Promise<void> {
    if (this.bm25Loaded) return;
    this.bm25Loaded = true; // set eagerly to prevent concurrent re-loads

    // Only SqliteVectorStore supports loadAllChunks() — MemoryVectorStore is always co-located
    if (!('loadAllChunks' in this.vectorStore)) return;

    const stored = await (this.vectorStore as SqliteVectorStore).loadAllChunks();
    if (stored.length === 0) return;

    for (const c of stored) {
      await this.oramaIndex.add({
        id: c.id,
        content: c.content,
        filePath: c.filePath,
        startLine: c.startLine,
        endLine: c.endLine,
        language: c.language,
        ...(c.symbolName ? { symbolName: c.symbolName } : {}),
      });
    }
  }

  private async _indexFilePaths(filePaths: string[]): Promise<void> {
    // Mark BM25 as loaded since we are actively rebuilding it right now
    this.bm25Loaded = true;

    for (const filePath of filePaths) {
      const entry = await this.fileIndexer.readFile(filePath);
      if (!entry) continue;

      const chunks = this.chunker.chunk({
        path: entry.path,
        contents: entry.contents,
        language: entry.language,
      });

      // Remove stale chunks for this file before re-indexing
      await this.oramaIndex.removeByFilePath(filePath);

      for (const chunk of chunks) {
        await this.oramaIndex.add(chunk);

        // Always persist chunk content to SQLite (enables cold-start BM25 restore)
        // and embed if the embedder is non-noop.
        const vec =
          this.embedder.dimensions !== 0
            ? await this.embedder.embed(chunk.content)
            : new Float32Array(0);

        await this.vectorStore.add(chunk.id, vec, {
          content: chunk.content, // stored separately in chunk_meta.content column
          filePath: chunk.filePath,
          startLine: String(chunk.startLine),
          endLine: String(chunk.endLine),
          language: chunk.language,
          ...(chunk.symbolName ? { symbolName: chunk.symbolName } : {}),
        });
      }
    }
  }
}
