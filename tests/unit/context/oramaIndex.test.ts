import { describe, it, expect, beforeEach } from 'vitest';
import { OramaIndex } from '../../../src/context/oramaIndex.js';
import type { Chunk } from '../../../src/types/context.types.js';

function makeChunk(id: string, content: string): Chunk {
  return {
    id,
    content,
    filePath: `src/${id}.ts`,
    startLine: 0,
    endLine: 10,
    language: 'typescript',
    symbolName: id,
  };
}

describe('OramaIndex', () => {
  let index: OramaIndex;

  beforeEach(async () => {
    index = new OramaIndex();
  });

  it('adds a chunk and finds it by search', async () => {
    const chunk = makeChunk('loginHandler', 'function handleLogin validates credentials');
    await index.add(chunk);
    const results = await index.search('handleLogin');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.chunk.id).toBe('loginHandler');
  });

  it('returns empty array for non-existent term', async () => {
    const chunk = makeChunk('foo', 'function foo does something');
    await index.add(chunk);
    const results = await index.search('nonexistent_xyz_abc_987');
    expect(results).toEqual([]);
  });

  it('clear removes all documents', async () => {
    await index.add(makeChunk('a', 'function alpha'));
    await index.add(makeChunk('b', 'function beta'));
    await index.clear();
    const results = await index.search('function');
    expect(results).toEqual([]);
  });

  it('size returns correct count', async () => {
    expect(index.size).toBe(0);
    await index.add(makeChunk('x', 'content x'));
    expect(index.size).toBe(1);
    await index.add(makeChunk('y', 'content y'));
    expect(index.size).toBe(2);
  });

  it('handles duplicate id by updating', async () => {
    const chunk = makeChunk('dup', 'original content');
    await index.add(chunk);
    const updated = { ...chunk, content: 'updated content' };
    await index.add(updated);
    expect(index.size).toBe(1);
    const results = await index.search('updated content');
    expect(results.length).toBeGreaterThan(0);
  });

  it('search returns results with scores', async () => {
    await index.add(makeChunk('auth', 'authentication token validation function'));
    const results = await index.search('authentication');
    expect(results[0]?.score).toBeGreaterThan(0);
  });
});
