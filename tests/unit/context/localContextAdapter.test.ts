import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalContextAdapter } from '../../../src/context/localContextAdapter.js';
import type { VectorStore, VectorSearchResult } from '../../../src/context/vectorStore.js';
import type { EmbeddingProvider } from '../../../src/context/embedders/embeddingProvider.js';
import type { Chunker } from '../../../src/context/treeChunker.js';
import type { FileIndexer, FileEntry } from '../../../src/context/fileIndexer.js';
import type { OramaIndex, BM25Result } from '../../../src/context/oramaIndex.js';
import type { Chunk } from '../../../src/types/context.types.js';

// ── Mini mocks ─────────────────────────────────────────────────────────────

function makeChunk(id: string, filePath = 'file.ts'): Chunk {
  return { id, content: `content of ${id}`, filePath, startLine: 1, endLine: 10, language: 'typescript' };
}

const mockVectorStore = (): VectorStore => ({
  add: vi.fn().mockResolvedValue(undefined),
  search: vi.fn().mockResolvedValue([]),
  remove: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  get size() {
    return Promise.resolve(0);
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

const mockOramaIndex = (): OramaIndex =>
  ({
    add: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    clear: vi.fn().mockResolvedValue(undefined),
    removeByFilePath: vi.fn().mockResolvedValue(undefined),
    size: 0,
    getSize: vi.fn().mockResolvedValue(0),
  }) as unknown as OramaIndex;

// ── Tests ──────────────────────────────────────────────────────────────────

describe('LocalContextAdapter', () => {
  describe('indexDirectory', () => {
    it('walks directory, chunks files, adds to orama and vector store', async () => {
      const chunk = makeChunk('c1');
      const file: FileEntry = { path: '/repo/file.ts', contents: 'const x = 1;', language: 'typescript' };
      const orama = mockOramaIndex();
      const embedder = mockEmbedder(3);
      const vs = mockVectorStore();
      const chunker = mockChunker([chunk]);
      const fileIndexer = mockFileIndexer([file]);

      const adapter = new LocalContextAdapter(fileIndexer, chunker, orama, vs, embedder);
      const result = await adapter.indexDirectory('/repo');

      expect(result.indexedFiles).toBe(1);
      expect(orama.add).toHaveBeenCalledWith(chunk);
      expect(vs.add).toHaveBeenCalledWith(
        'c1',
        expect.any(Float32Array),
        expect.objectContaining({ filePath: 'file.ts' }),
      );
    });

    it('persists chunk content to vector store even when embedder is noop (dims=0)', async () => {
      const chunk = makeChunk('c1');
      const file: FileEntry = { path: '/repo/file.ts', contents: 'const x = 1;', language: 'typescript' };
      const orama = mockOramaIndex();
      const embedder = mockEmbedder(0); // noop
      const vs = mockVectorStore();
      const chunker = mockChunker([chunk]);
      const fileIndexer = mockFileIndexer([file]);

      const adapter = new LocalContextAdapter(fileIndexer, chunker, orama, vs, embedder);
      await adapter.indexDirectory('/repo');

      expect(orama.add).toHaveBeenCalledWith(chunk);
      // vs.add is always called now (persists chunk content for cold-start BM25 restore)
      // Vector passed is zero-length since embedder is noop
      expect(vs.add).toHaveBeenCalledWith(
        chunk.id,
        new Float32Array(0),
        expect.objectContaining({ content: chunk.content, filePath: chunk.filePath }),
      );
    });
  });

  describe('search', () => {
    it('returns BM25-only results when embedder is noop', async () => {
      const chunk = makeChunk('bm25-1');
      const orama = mockOramaIndex();
      const bm25Result: BM25Result = { id: 'bm25-1', score: 0.9, chunk };
      (orama.search as ReturnType<typeof vi.fn>).mockResolvedValue([bm25Result]);

      const embedder = mockEmbedder(0);
      const vs = mockVectorStore();

      const adapter = new LocalContextAdapter(mockFileIndexer([]), mockChunker([]), orama, vs, embedder);
      const results = await adapter.search('some query');

      expect(results).toHaveLength(1);
      expect(results[0].chunk.id).toBe('bm25-1');
      expect(vs.search).not.toHaveBeenCalled();
    });

    it('merges BM25 and vector results via RRF', async () => {
      const chunkA = makeChunk('vec-only');
      const chunkB = makeChunk('bm25-only');

      const orama = mockOramaIndex();
      const bm25Result: BM25Result = { id: 'bm25-only', score: 0.8, chunk: chunkB };
      (orama.search as ReturnType<typeof vi.fn>).mockResolvedValue([bm25Result]);

      const vecResult: VectorSearchResult = {
        id: 'vec-only',
        score: 0.9,
        metadata: { filePath: 'a.ts', startLine: '1', endLine: '5', language: 'typescript' },
      };
      const vs = mockVectorStore();
      (vs.search as ReturnType<typeof vi.fn>).mockResolvedValue([vecResult]);

      const embedder = mockEmbedder(3);
      const adapter = new LocalContextAdapter(mockFileIndexer([]), mockChunker([]), orama, vs, embedder);
      const results = await adapter.search('query');

      const ids = results.map((r) => r.chunk.id);
      expect(ids).toContain('bm25-only');
      expect(ids).toContain('vec-only');
    });

    it('item appearing in both BM25 and vector gets higher RRF score', async () => {
      const shared = makeChunk('shared');
      const unique = makeChunk('unique-vec');

      const orama = mockOramaIndex();
      (orama.search as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'shared', score: 0.5, chunk: shared },
      ]);

      const vs = mockVectorStore();
      (vs.search as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'shared', score: 0.8, metadata: {} },
        { id: 'unique-vec', score: 0.7, metadata: {} },
      ]);

      const embedder = mockEmbedder(3);
      const adapter = new LocalContextAdapter(mockFileIndexer([]), mockChunker([]), orama, vs, embedder);
      const results = await adapter.search('query');

      const sharedResult = results.find((r) => r.chunk.id === 'shared');
      const uniqueResult = results.find((r) => r.chunk.id === 'unique-vec');
      expect(sharedResult).toBeDefined();
      expect(uniqueResult).toBeDefined();
      // shared appears in both BM25 and vector, so higher RRF score
      expect(sharedResult!.score).toBeGreaterThan(uniqueResult!.score);
    });
  });

  describe('clearIndex', () => {
    it('clears both orama and vector store', async () => {
      const orama = mockOramaIndex();
      const vs = mockVectorStore();
      const adapter = new LocalContextAdapter(mockFileIndexer([]), mockChunker([]), orama, vs, mockEmbedder());
      await adapter.clearIndex();
      expect(orama.clear).toHaveBeenCalled();
      expect(vs.clear).toHaveBeenCalled();
    });
  });

  describe('removeFiles', () => {
    it('calls removeByFilePath on orama index', async () => {
      const orama = mockOramaIndex();
      const adapter = new LocalContextAdapter(
        mockFileIndexer([]),
        mockChunker([]),
        orama,
        mockVectorStore(),
        mockEmbedder(),
      );
      await adapter.removeFiles(['/repo/old.ts']);
      expect(orama.removeByFilePath).toHaveBeenCalledWith('/repo/old.ts');
    });
  });

  describe('dispose', () => {
    it('closes the vector store', async () => {
      const vs = mockVectorStore();
      const adapter = new LocalContextAdapter(mockFileIndexer([]), mockChunker([]), mockOramaIndex(), vs, mockEmbedder());
      await adapter.dispose();
      expect(vs.close).toHaveBeenCalled();
    });
  });
});
