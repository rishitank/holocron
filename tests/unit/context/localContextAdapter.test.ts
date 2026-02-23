import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalContextAdapter } from '../../../src/context/localContextAdapter.js';
import type { HybridStore, BM25Hit, VectorHit } from '../../../src/context/hybridStore.js';
import type { EmbeddingProvider } from '../../../src/context/embedders/embeddingProvider.js';
import type { Chunker } from '../../../src/context/treeChunker.js';
import type { FileIndexer, FileEntry } from '../../../src/context/fileIndexer.js';
import type { Chunk } from '../../../src/types/context.types.js';

// ── Mini mocks ─────────────────────────────────────────────────────────────

function makeChunk(id: string, filePath = 'file.ts', content = `content of ${id}`): Chunk {
  return { id, content, filePath, startLine: 1, endLine: 10, language: 'typescript' };
}

/** Create a BM25Hit with required v3 temporal metadata. */
function makeBM25Hit(chunk: Chunk, score = 0.9, ingestedAt = Date.now()): BM25Hit {
  return { id: chunk.id, score, chunk, ingestedAt, memoryType: 'semantic' };
}

/** Create a VectorHit with required v3 temporal metadata. */
function makeVectorHit(chunk: Chunk, score = 0.9, ingestedAt = Date.now()): VectorHit {
  return { id: chunk.id, score, chunk, ingestedAt, memoryType: 'semantic' };
}

const mockHybridStore = (): HybridStore => ({
  ensureReady: vi.fn().mockResolvedValue(undefined),
  addBatch: vi.fn().mockResolvedValue(undefined),
  searchBM25: vi.fn().mockResolvedValue([]),
  searchVector: vi.fn().mockResolvedValue([]),
  getChunkById: vi.fn().mockResolvedValue(null),
  addLinks: vi.fn().mockResolvedValue(undefined),
  getLinks: vi.fn().mockResolvedValue([]),
  logIndexEvent: vi.fn().mockResolvedValue(undefined),
  removeByFilePath: vi.fn().mockResolvedValue(undefined),
  clearAll: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
  get size() {
    return 0;
  },
  get hasVectors() {
    return false;
  },
});

const mockEmbedder = (dims = 0): EmbeddingProvider => ({
  embed: vi.fn().mockResolvedValue(new Float32Array(dims)),
  dimensions: dims,
  isAvailable: vi.fn().mockResolvedValue(true),
});

const mockChunker = (chunks: Chunk[]): Chunker => ({
  chunk: vi.fn().mockReturnValue(chunks),
});

const mockFileIndexer = (entries: FileEntry[]): FileIndexer =>
  ({
    walkDirectory: vi.fn().mockImplementation(async function* () {
      for (const e of entries) yield e;
    }),
    readFile: vi.fn().mockImplementation(async (path: string) => {
      return entries.find((e) => e.path === path) ?? null;
    }),
  }) as unknown as FileIndexer;

// ── Tests ──────────────────────────────────────────────────────────────────

describe('LocalContextAdapter', () => {
  describe('indexDirectory', () => {
    it('walks directory, chunks files, and calls addBatch', async () => {
      const chunk = makeChunk('c1');
      const file: FileEntry = {
        path: '/repo/file.ts',
        contents: 'const x = 1;',
        language: 'typescript',
      };
      const store = mockHybridStore();
      const embedder = mockEmbedder(3);
      const chunker = mockChunker([chunk]);
      const fileIndexer = mockFileIndexer([file]);

      const adapter = new LocalContextAdapter(fileIndexer, chunker, store, embedder);
      const result = await adapter.indexDirectory('/repo');

      expect(result.indexedFiles).toBe(1);
      expect(result.chunks).toBe(1);
      expect(store.addBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ chunk }),
        ]),
      );
    });

    it('returns correct chunk count from indexDirectory', async () => {
      const chunks = [makeChunk('c1'), makeChunk('c2'), makeChunk('c3')];
      const file: FileEntry = { path: '/repo/file.ts', contents: 'x', language: 'typescript' };
      const store = mockHybridStore();

      const adapter = new LocalContextAdapter(
        mockFileIndexer([file]),
        mockChunker(chunks),
        store,
        mockEmbedder(0),
      );
      const result = await adapter.indexDirectory('/repo');

      expect(result.chunks).toBe(3);
    });

    it('passes contextual prefix to embedder.embed(), not raw chunk content', async () => {
      // Contextual enrichment: embedding receives "File: ...\nLanguage: ...\n\n{content}"
      // Raw content is still stored in the DB — only the embedding input is enriched.
      const chunk = makeChunk('c1', '/repo/auth/service.ts', 'function login() {}');
      const file: FileEntry = {
        path: '/repo/auth/service.ts',
        contents: 'function login() {}',
        language: 'typescript',
      };
      const store = mockHybridStore();
      const embedder = mockEmbedder(3);

      const adapter = new LocalContextAdapter(mockFileIndexer([file]), mockChunker([chunk]), store, embedder);
      await adapter.indexDirectory('/repo');

      const embedCall = (embedder.embed as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      // Enriched prefix must be present
      expect(embedCall).toContain('File:');
      expect(embedCall).toContain('Language:');
      // Original content must also be present (appended after prefix)
      expect(embedCall).toContain('function login() {}');
      // Raw content alone was NOT passed (prefix was added)
      expect(embedCall).not.toBe('function login() {}');
    });

    it('persists chunk content to store even when embedder is noop (dims=0)', async () => {
      const chunk = makeChunk('c1');
      const file: FileEntry = { path: '/repo/file.ts', contents: 'const x = 1;', language: 'typescript' };
      const store = mockHybridStore();
      const embedder = mockEmbedder(0); // noop

      const adapter = new LocalContextAdapter(mockFileIndexer([file]), mockChunker([chunk]), store, embedder);
      await adapter.indexDirectory('/repo');

      const call = (store.addBatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call[0].chunk.id).toBe('c1');
      expect(call[0].vector).toEqual(new Float32Array(0));
    });

    it('passes memoryType in BatchEntry based on file path', async () => {
      // .ts → semantic; .json → procedural
      const tsChunk = makeChunk('c-ts', '/repo/src/service.ts');
      const jsonChunk = makeChunk('c-json', '/repo/package.json');
      const files: FileEntry[] = [
        { path: '/repo/src/service.ts', contents: 'x', language: 'typescript' },
        { path: '/repo/package.json', contents: '{}', language: 'json' },
      ];
      const store = mockHybridStore();
      const adapter = new LocalContextAdapter(
        mockFileIndexer(files),
        {
          chunk: vi.fn().mockImplementation(({ path }: { path: string }) =>
            path.endsWith('.ts') ? [tsChunk] : [jsonChunk],
          ),
        } as unknown as import('../../../src/context/treeChunker.js').Chunker,
        store,
        mockEmbedder(0),
      );
      await adapter.indexDirectory('/repo');

      const call = (store.addBatch as ReturnType<typeof vi.fn>).mock.calls[0][0] as
        { chunk: Chunk; vector: Float32Array; memoryType: string }[];
      const tsEntry = call.find((e) => e.chunk.id === 'c-ts');
      const jsonEntry = call.find((e) => e.chunk.id === 'c-json');
      expect(tsEntry?.memoryType).toBe('semantic');
      expect(jsonEntry?.memoryType).toBe('procedural');
    });

    it('calls logIndexEvent after indexing with correct counts', async () => {
      const chunks = [makeChunk('c1'), makeChunk('c2')];
      const file: FileEntry = { path: '/repo/file.ts', contents: 'x', language: 'typescript' };
      const store = mockHybridStore();

      const adapter = new LocalContextAdapter(
        mockFileIndexer([file]),
        mockChunker(chunks),
        store,
        mockEmbedder(0),
      );
      await adapter.indexDirectory('/repo');

      expect(store.logIndexEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'full',
          filesChanged: 1,
          chunksAdded: 2,
        }),
      );
    });

    it('removes stale chunks before re-indexing a file', async () => {
      const file: FileEntry = { path: '/repo/file.ts', contents: 'x', language: 'typescript' };
      const store = mockHybridStore();

      const adapter = new LocalContextAdapter(
        mockFileIndexer([file]),
        mockChunker([makeChunk('c1')]),
        store,
        mockEmbedder(0),
      );
      await adapter.indexDirectory('/repo');

      expect(store.removeByFilePath).toHaveBeenCalledWith('/repo/file.ts');
    });
  });

  describe('search', () => {
    it('returns BM25-only results when embedder is noop', async () => {
      const chunk = makeChunk('bm25-1');
      const store = mockHybridStore();
      (store.searchBM25 as ReturnType<typeof vi.fn>).mockResolvedValue([makeBM25Hit(chunk, 0.9)]);

      const adapter = new LocalContextAdapter(mockFileIndexer([]), mockChunker([]), store, mockEmbedder(0));
      const results = await adapter.search('some query');

      expect(results).toHaveLength(1);
      expect(results[0]!.chunk.id).toBe('bm25-1');
      expect(store.searchVector).not.toHaveBeenCalled();
    });

    it('calls searchVector when embedder has dimensions > 0', async () => {
      const store = mockHybridStore();
      const embedder = mockEmbedder(3);

      const adapter = new LocalContextAdapter(mockFileIndexer([]), mockChunker([]), store, embedder);
      await adapter.search('query');

      expect(store.searchVector).toHaveBeenCalled();
    });

    it('merges BM25 and vector results via RRF', async () => {
      const chunkA = makeChunk('vec-only');
      const chunkB = makeChunk('bm25-only');

      const store = mockHybridStore();
      (store.searchBM25 as ReturnType<typeof vi.fn>).mockResolvedValue([makeBM25Hit(chunkB, 0.8)]);
      (store.searchVector as ReturnType<typeof vi.fn>).mockResolvedValue([makeVectorHit(chunkA, 0.9)]);

      const adapter = new LocalContextAdapter(mockFileIndexer([]), mockChunker([]), store, mockEmbedder(3));
      const results = await adapter.search('query');

      const ids = results.map((r) => r.chunk.id);
      expect(ids).toContain('bm25-only');
      expect(ids).toContain('vec-only');
    });

    it('item in both BM25 and vector results gets higher RRF score', async () => {
      const shared = makeChunk('shared');
      const unique = makeChunk('unique-vec');

      const store = mockHybridStore();
      (store.searchBM25 as ReturnType<typeof vi.fn>).mockResolvedValue([makeBM25Hit(shared, 0.5)]);
      (store.searchVector as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeVectorHit(shared, 0.8),
        makeVectorHit(unique, 0.7),
      ]);

      const adapter = new LocalContextAdapter(mockFileIndexer([]), mockChunker([]), store, mockEmbedder(3));
      const results = await adapter.search('query');

      const sharedResult = results.find((r) => r.chunk.id === 'shared');
      const uniqueResult = results.find((r) => r.chunk.id === 'unique-vec');
      expect(sharedResult).toBeDefined();
      expect(uniqueResult).toBeDefined();
      expect(sharedResult!.score).toBeGreaterThan(uniqueResult!.score);
    });

    it('applies recency decay: older chunks score lower than fresh chunks', async () => {
      const freshChunk = makeChunk('fresh');
      const oldChunk = makeChunk('old');
      const now = Date.now();
      const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;

      const store = mockHybridStore();
      // Same RRF rank → same base score; only decay differs
      (store.searchBM25 as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeBM25Hit(freshChunk, 1.0, now),         // ingested now
        makeBM25Hit(oldChunk, 1.0, oneYearAgo),    // ingested 1 year ago
      ]);

      const adapter = new LocalContextAdapter(mockFileIndexer([]), mockChunker([]), store, mockEmbedder(0));
      const results = await adapter.search('query');

      const freshResult = results.find((r) => r.chunk.id === 'fresh');
      const oldResult = results.find((r) => r.chunk.id === 'old');
      expect(freshResult).toBeDefined();
      expect(oldResult).toBeDefined();
      // Fresh chunk should score higher due to no decay
      expect(freshResult!.score).toBeGreaterThan(oldResult!.score);
    });

    it('applies 0.8x weight to procedural chunks', async () => {
      const semanticChunk = makeChunk('semantic');
      const proceduralChunk = makeChunk('procedural');
      const now = Date.now();

      const store = mockHybridStore();
      // Same rank → same RRF base; only type weight differs
      (store.searchBM25 as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'semantic', score: 1.0, chunk: semanticChunk, ingestedAt: now, memoryType: 'semantic' } satisfies BM25Hit,
        { id: 'procedural', score: 1.0, chunk: proceduralChunk, ingestedAt: now, memoryType: 'procedural' } satisfies BM25Hit,
      ]);

      const adapter = new LocalContextAdapter(mockFileIndexer([]), mockChunker([]), store, mockEmbedder(0));
      const results = await adapter.search('query');

      const semanticResult = results.find((r) => r.chunk.id === 'semantic');
      const proceduralResult = results.find((r) => r.chunk.id === 'procedural');
      expect(semanticResult).toBeDefined();
      expect(proceduralResult).toBeDefined();
      // Semantic should score higher (1.0× vs 0.8×)
      expect(semanticResult!.score).toBeGreaterThan(proceduralResult!.score);
    });

    it('respects maxResults option', async () => {
      const chunks = Array.from({ length: 10 }, (_, i) => makeChunk(`c${i}`));
      const store = mockHybridStore();
      (store.searchBM25 as ReturnType<typeof vi.fn>).mockResolvedValue(
        chunks.map((chunk, i) => makeBM25Hit(chunk, 1 - i * 0.1)),
      );

      const adapter = new LocalContextAdapter(mockFileIndexer([]), mockChunker([]), store, mockEmbedder(0));
      const results = await adapter.search('query', { maxResults: 3 });

      expect(results).toHaveLength(3);
    });
  });

  describe('clearIndex', () => {
    it('calls clearAll on the hybrid store', async () => {
      const store = mockHybridStore();
      const adapter = new LocalContextAdapter(mockFileIndexer([]), mockChunker([]), store, mockEmbedder());
      await adapter.clearIndex();
      expect(store.clearAll).toHaveBeenCalled();
    });
  });

  describe('removeFiles', () => {
    it('calls removeByFilePath on the store for each file', async () => {
      const store = mockHybridStore();
      const adapter = new LocalContextAdapter(mockFileIndexer([]), mockChunker([]), store, mockEmbedder());
      await adapter.removeFiles(['/repo/old.ts', '/repo/gone.ts']);
      expect(store.removeByFilePath).toHaveBeenCalledWith('/repo/old.ts');
      expect(store.removeByFilePath).toHaveBeenCalledWith('/repo/gone.ts');
    });
  });

  describe('dispose', () => {
    it('closes the hybrid store', async () => {
      const store = mockHybridStore();
      const adapter = new LocalContextAdapter(mockFileIndexer([]), mockChunker([]), store, mockEmbedder());
      await adapter.dispose();
      expect(store.close).toHaveBeenCalled();
    });
  });
});
