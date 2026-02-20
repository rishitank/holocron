import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteVectorStore } from '../../../src/context/sqliteVectorStore.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

function makeVec(...vals: number[]): Float32Array {
  return new Float32Array(vals);
}

describe('SqliteVectorStore', () => {
  let store: SqliteVectorStore;

  beforeEach(async () => {
    // Use :memory: for zero filesystem I/O
    store = new SqliteVectorStore(':memory:');
  });

  afterEach(async () => {
    await store.close();
  });

  it('add and search returns the correct id', async () => {
    await store.add('c1', makeVec(1, 0, 0), { filePath: 'c1.ts' });
    const results = await store.search(makeVec(1, 0, 0), 1);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('c1');
    expect(results[0].metadata).toEqual({ filePath: 'c1.ts' });
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('search returns results sorted by similarity descending', async () => {
    await store.add('c1', makeVec(1, 0, 0), { filePath: 'c1.ts' });
    await store.add('c2', makeVec(0, 1, 0), { filePath: 'c2.ts' });
    await store.add('c3', makeVec(0, 0, 1), { filePath: 'c3.ts' });

    const results = await store.search(makeVec(1, 0, 0), 3);
    expect(results[0].id).toBe('c1');
    // c1 is most similar (score close to 1)
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('respects topK limit', async () => {
    await store.add('a', makeVec(1, 0, 0), {});
    await store.add('b', makeVec(0, 1, 0), {});
    await store.add('c', makeVec(0, 0, 1), {});

    const results = await store.search(makeVec(1, 0, 0), 2);
    expect(results).toHaveLength(2);
  });

  it('remove deletes the entry', async () => {
    await store.add('x', makeVec(1, 0), {});
    await store.remove('x');
    const results = await store.search(makeVec(1, 0), 5);
    expect(results.map((r) => r.id)).not.toContain('x');
  });

  it('clear empties the store', async () => {
    await store.add('a', makeVec(1, 0), {});
    await store.add('b', makeVec(0, 1), {});
    await store.clear();
    expect(await store.size).toBe(0);
    expect(await store.search(makeVec(1, 0), 5)).toHaveLength(0);
  });

  it('size getter reflects current count', async () => {
    expect(await store.size).toBe(0);
    await store.add('a', makeVec(1, 0), {});
    expect(await store.size).toBe(1);
    await store.add('b', makeVec(0, 1), {});
    expect(await store.size).toBe(2);
  });

  it('returns empty array for zero-dimension query (noop embedder)', async () => {
    const results = await store.search(new Float32Array(0), 5);
    expect(results).toHaveLength(0);
  });

  it('stores chunk metadata but skips vector when vector is zero-length (noop embedder)', async () => {
    await store.add('noop-id', new Float32Array(0), { content: 'fn foo() {}', filePath: '/a.ts', startLine: '1', endLine: '3', language: 'typescript' });
    // Metadata is always persisted (enables cold-start BM25 restore)
    expect(await store.size).toBe(1);
    // Vector search still returns empty (no embedding stored)
    const results = await store.search(new Float32Array(0), 5);
    expect(results).toHaveLength(0);
  });

  it('update: adding same id overwrites the entry', async () => {
    await store.add('dup', makeVec(1, 0), { v: '1' });
    await store.add('dup', makeVec(0, 1), { v: '2' });
    expect(await store.size).toBe(1);
    const results = await store.search(makeVec(0, 1), 1);
    expect(results[0].id).toBe('dup');
    expect(results[0].metadata).toEqual({ v: '2' });
  });

  it('throws on dimension mismatch', async () => {
    await store.add('a', makeVec(1, 0, 0), {});
    await expect(store.add('b', makeVec(1, 0), {})).rejects.toThrow('dimension mismatch');
  });

  it('persists vectors to disk and survives reopen', async () => {
    const dbPath = join(tmpdir(), `test-darth-proxy-${Date.now()}.db`);
    const s1 = new SqliteVectorStore(dbPath);
    try {
      await s1.add('p1', makeVec(1, 0, 0), { file: 'persist.ts' });
      await s1.close();

      const s2 = new SqliteVectorStore(dbPath);
      const results = await s2.search(makeVec(1, 0, 0), 1);
      await s2.close();

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('p1');
      expect(results[0].metadata).toEqual({ file: 'persist.ts' });
    } finally {
      await rm(dbPath, { force: true }).catch(() => {});
    }
  });
});
