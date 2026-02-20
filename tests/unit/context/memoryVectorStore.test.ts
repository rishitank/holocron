import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryVectorStore } from '../../../src/context/memoryVectorStore.js';

function makeVec(...vals: number[]): Float32Array {
  return new Float32Array(vals);
}

describe('MemoryVectorStore', () => {
  let store: MemoryVectorStore;

  beforeEach(() => {
    store = new MemoryVectorStore();
  });

  it('add and search returns the correct id', async () => {
    await store.add('a', makeVec(1, 0, 0), { file: 'a.ts' });
    const results = await store.search(makeVec(1, 0, 0), 1);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('a');
    expect(results[0].score).toBeCloseTo(1.0);
    expect(results[0].metadata).toEqual({ file: 'a.ts' });
  });

  it('search returns results sorted by similarity descending', async () => {
    await store.add('a', makeVec(1, 0, 0), { file: 'a.ts' });
    await store.add('b', makeVec(0, 1, 0), { file: 'b.ts' });
    await store.add('c', makeVec(0.9, 0.1, 0), { file: 'c.ts' });

    const results = await store.search(makeVec(1, 0, 0), 3);
    expect(results[0].id).toBe('a');
    expect(results[1].id).toBe('c');
    expect(results[2].id).toBe('b');
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

  it('handles close gracefully', async () => {
    await expect(store.close()).resolves.toBeUndefined();
  });

  it('update: adding same id overwrites the entry', async () => {
    await store.add('dup', makeVec(1, 0), { v: '1' });
    await store.add('dup', makeVec(0, 1), { v: '2' });
    expect(await store.size).toBe(1);
    const results = await store.search(makeVec(0, 1), 1);
    expect(results[0].id).toBe('dup');
    expect(results[0].metadata).toEqual({ v: '2' });
  });
});
