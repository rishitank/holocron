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

const mockHybridStore = (): HybridStore => ({
  ensureReady: vi.fn().mockResolvedValue(undefined),
  addBatch: vi.fn().mockResolvedValue(undefined),
  searchBM25: vi.fn().mockResolvedValue([]),
  searchVector: vi.fn().mockResolvedValue([]),
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
      const bm25Hit: BM25Hit = { id: 'bm25-1', score: 0.9, chunk };
      (store.searchBM25 as ReturnType<typeof vi.fn>).mockResolvedValue([bm25Hit]);

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
      (store.searchBM25 as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'bm25-only', score: 0.8, chunk: chunkB } satisfies BM25Hit,
      ]);
      (store.searchVector as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'vec-only', score: 0.9, chunk: chunkA } satisfies VectorHit,
      ]);

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
      (store.searchBM25 as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'shared', score: 0.5, chunk: shared } satisfies BM25Hit,
      ]);
      (store.searchVector as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'shared', score: 0.8, chunk: shared } satisfies VectorHit,
        { id: 'unique-vec', score: 0.7, chunk: unique } satisfies VectorHit,
      ]);

      const adapter = new LocalContextAdapter(mockFileIndexer([]), mockChunker([]), store, mockEmbedder(3));
      const results = await adapter.search('query');

      const sharedResult = results.find((r) => r.chunk.id === 'shared');
      const uniqueResult = results.find((r) => r.chunk.id === 'unique-vec');
      expect(sharedResult).toBeDefined();
      expect(uniqueResult).toBeDefined();
      expect(sharedResult!.score).toBeGreaterThan(uniqueResult!.score);
    });

    it('respects maxResults option', async () => {
      const chunks = Array.from({ length: 10 }, (_, i) => makeChunk(`c${i}`));
      const store = mockHybridStore();
      (store.searchBM25 as ReturnType<typeof vi.fn>).mockResolvedValue(
        chunks.map((chunk, i) => ({ id: chunk.id, score: 1 - i * 0.1, chunk }) satisfies BM25Hit),
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
