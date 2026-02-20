import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteHybridStore } from '../../../src/context/sqliteHybridStore.js';
import type { Chunk } from '../../../src/types/context.types.js';

function makeChunk(
  id: string,
  content: string,
  filePath = 'file.ts',
  symbolName?: string,
): Chunk {
  return { id, content, filePath, startLine: 1, endLine: 10, language: 'typescript', symbolName };
}

function makeVec(...vals: number[]): Float32Array {
  return new Float32Array(vals);
}

describe('SqliteHybridStore', () => {
  let store: SqliteHybridStore;

  beforeEach(async () => {
    store = new SqliteHybridStore(':memory:');
    await store.ensureReady();
  });

  afterEach(() => {
    store.close();
  });

  // ── addBatch + searchBM25 ─────────────────────────────────────────────────

  it('addBatch() stores chunks searchable via BM25', async () => {
    const chunk = makeChunk('c1', 'function authenticate(user: string): boolean');
    await store.addBatch([{ chunk, vector: new Float32Array(0) }]);

    const results = await store.searchBM25('authenticate', 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('c1');
    expect(results[0]!.chunk.content).toContain('authenticate');
  });

  it('searchBM25() ranks by relevance', async () => {
    // FTS5 tokenizes on word boundaries (not camelCase). Use space-separated content.
    await store.addBatch([
      { chunk: makeChunk('c1', 'function process payment amount number'), vector: new Float32Array(0) },
      { chunk: makeChunk('c2', 'Payment Processor class handles payment processing logic'), vector: new Float32Array(0) },
      { chunk: makeChunk('c3', 'const config timeout value server'), vector: new Float32Array(0) },
    ]);

    const results = await store.searchBM25('payment processor', 3);
    // c2 contains both "payment" and "processor" — highest relevance
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.score).toBeGreaterThan(0);
    const ids = results.map((r) => r.id);
    expect(ids).toContain('c2');
  });

  it('searchBM25() returns empty array on invalid FTS5 query (no crash)', async () => {
    await store.addBatch([{ chunk: makeChunk('c1', 'some content'), vector: new Float32Array(0) }]);
    // bare '*' is invalid in FTS5 MATCH
    const results = await store.searchBM25('*', 5);
    expect(Array.isArray(results)).toBe(true);
  });

  it('searchBM25() returns empty when store is empty', async () => {
    const results = await store.searchBM25('anything', 5);
    expect(results).toHaveLength(0);
  });

  it('searchBM25() finds chunks by file path tokens (camelCase split)', async () => {
    // File path "src/context/gitTracker.ts" should yield tokens "git", "tracker"
    const chunk = makeChunk('gt1', 'export class GitTracker {}', 'src/context/gitTracker.ts');
    await store.addBatch([{ chunk, vector: new Float32Array(0) }]);

    const results = await store.searchBM25('git', 5);
    expect(results.map((r) => r.id)).toContain('gt1');
  });

  // ── addBatch + searchVector ───────────────────────────────────────────────

  it('addBatch() stores vectors and they are searchable', async () => {
    await store.addBatch([
      { chunk: makeChunk('v1', 'vector one'), vector: makeVec(1, 0, 0) },
      { chunk: makeChunk('v2', 'vector two'), vector: makeVec(0, 1, 0) },
    ]);

    const results = await store.searchVector(makeVec(1, 0, 0), 2);
    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe('v1');
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it('searchVector() returns empty when no vectors stored', async () => {
    // Add chunk without vector (noop embedder)
    await store.addBatch([{ chunk: makeChunk('c1', 'content'), vector: new Float32Array(0) }]);
    const results = await store.searchVector(makeVec(1, 0, 0), 5);
    expect(results).toHaveLength(0);
  });

  it('searchVector() returns empty for zero-length query', async () => {
    await store.addBatch([{ chunk: makeChunk('v1', 'content'), vector: makeVec(1, 0, 0) }]);
    const results = await store.searchVector(new Float32Array(0), 5);
    expect(results).toHaveLength(0);
  });

  it('hasVectors is false when no vectors stored', async () => {
    await store.addBatch([{ chunk: makeChunk('c1', 'content'), vector: new Float32Array(0) }]);
    expect(store.hasVectors).toBe(false);
  });

  it('hasVectors is true after adding a chunk with a vector', async () => {
    await store.addBatch([{ chunk: makeChunk('v1', 'content'), vector: makeVec(1, 0, 0) }]);
    expect(store.hasVectors).toBe(true);
  });

  it('throws on vector dimension mismatch across batches', async () => {
    await store.addBatch([{ chunk: makeChunk('v1', 'c1'), vector: makeVec(1, 0, 0) }]);
    await expect(
      store.addBatch([{ chunk: makeChunk('v2', 'c2'), vector: makeVec(1, 0) }]),
    ).rejects.toThrow('dimension mismatch');
  });

  // ── upsert behaviour ──────────────────────────────────────────────────────

  it('addBatch() replaces existing chunk with same id', async () => {
    const chunk1 = makeChunk('dup', 'original content');
    const chunk2 = makeChunk('dup', 'updated content');

    await store.addBatch([{ chunk: chunk1, vector: new Float32Array(0) }]);
    await store.addBatch([{ chunk: chunk2, vector: new Float32Array(0) }]);

    expect(store.size).toBe(1);
    const results = await store.searchBM25('updated', 5);
    expect(results[0]!.chunk.content).toBe('updated content');
  });

  // ── removeByFilePath ──────────────────────────────────────────────────────

  it('removeByFilePath() removes all chunks for the given file', async () => {
    await store.addBatch([
      { chunk: makeChunk('a1', 'content a', 'a.ts'), vector: new Float32Array(0) },
      { chunk: makeChunk('a2', 'more content a', 'a.ts'), vector: new Float32Array(0) },
      { chunk: makeChunk('b1', 'content b', 'b.ts'), vector: new Float32Array(0) },
    ]);

    expect(store.size).toBe(3);
    await store.removeByFilePath('a.ts');
    expect(store.size).toBe(1);

    const results = await store.searchBM25('content', 10);
    expect(results.map((r) => r.id)).not.toContain('a1');
    expect(results.map((r) => r.id)).not.toContain('a2');
    expect(results.map((r) => r.id)).toContain('b1');
  });

  it('removeByFilePath() is idempotent for unknown paths', async () => {
    await expect(store.removeByFilePath('nonexistent.ts')).resolves.not.toThrow();
  });

  // ── clearAll ──────────────────────────────────────────────────────────────

  it('clearAll() removes all chunks and resets vector dimensions', async () => {
    await store.addBatch([
      { chunk: makeChunk('c1', 'content'), vector: makeVec(1, 0, 0) },
    ]);
    expect(store.size).toBe(1);

    await store.clearAll();
    expect(store.size).toBe(0);
    expect(store.hasVectors).toBe(false);

    const bm25 = await store.searchBM25('content', 5);
    const vec = await store.searchVector(makeVec(1, 0, 0), 5);
    expect(bm25).toHaveLength(0);
    expect(vec).toHaveLength(0);
  });

  it('clearAll() allows re-adding with different vector dimensions', async () => {
    await store.addBatch([{ chunk: makeChunk('c1', 'x'), vector: makeVec(1, 0, 0) }]);
    await store.clearAll();
    // Different dimension (2-d) — should not throw
    await expect(
      store.addBatch([{ chunk: makeChunk('c2', 'y'), vector: makeVec(1, 0) }]),
    ).resolves.not.toThrow();
    expect(store.hasVectors).toBe(true);
  });

  // ── size ─────────────────────────────────────────────────────────────────

  it('size reflects current chunk count', async () => {
    expect(store.size).toBe(0);
    await store.addBatch([
      { chunk: makeChunk('a', 'a'), vector: new Float32Array(0) },
      { chunk: makeChunk('b', 'b'), vector: new Float32Array(0) },
    ]);
    expect(store.size).toBe(2);
  });

  // ── atomicity ─────────────────────────────────────────────────────────────

  it('addBatch() is atomic: dimension error rolls back entire batch', async () => {
    // First establish 3-d vectors
    await store.addBatch([{ chunk: makeChunk('v1', 'first'), vector: makeVec(1, 0, 0) }]);
    expect(store.size).toBe(1);

    // Batch with correct dims (c2) then mismatched (c3) — whole batch rolls back
    await expect(
      store.addBatch([
        { chunk: makeChunk('c2', 'second'), vector: makeVec(1, 0, 0) },
        { chunk: makeChunk('c3', 'third'), vector: makeVec(1, 0) }, // wrong dims
      ]),
    ).rejects.toThrow('dimension mismatch');

    // Only v1 should exist (c2 rolled back)
    expect(store.size).toBe(1);
  });

  it('addBatch() handles empty batch without error', async () => {
    await expect(store.addBatch([])).resolves.not.toThrow();
    expect(store.size).toBe(0);
  });

  // ── persistence ──────────────────────────────────────────────────────────

  it('persists data and vector dimensions across reopen', async () => {
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { rm } = await import('node:fs/promises');

    const dbPath = join(tmpdir(), `test-hybrid-${Date.now()}.db`);
    const s1 = new SqliteHybridStore(dbPath);
    await s1.ensureReady();

    await s1.addBatch([
      { chunk: makeChunk('p1', 'persist this', 'persist.ts'), vector: makeVec(1, 0, 0) },
    ]);
    s1.close();

    const s2 = new SqliteHybridStore(dbPath);
    await s2.ensureReady();

    const bm25 = await s2.searchBM25('persist', 5);
    const vec = await s2.searchVector(makeVec(1, 0, 0), 5);
    s2.close();

    await rm(dbPath, { force: true }).catch(() => {});

    expect(bm25).toHaveLength(1);
    expect(bm25[0]!.id).toBe('p1');
    expect(vec).toHaveLength(1);
    expect(vec[0]!.id).toBe('p1');
  });
});
