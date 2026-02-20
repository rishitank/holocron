import { describe, it, expect } from 'vitest';
import { formatContext } from '../../../src/enhancers/contextFormatter.js';
import type { SearchResult } from '../../../src/types/context.types.js';
import type { Chunk } from '../../../src/types/context.types.js';

function makeChunk(id: string, filePath = 'src/auth.ts', start = 10, end = 30): Chunk {
  return {
    id,
    content: `function ${id}() { return true; }`,
    filePath,
    startLine: start,
    endLine: end,
    language: 'typescript',
    symbolName: id,
  };
}

function makeResult(id: string, score = 0.9, filePath = 'src/auth.ts'): SearchResult {
  return { chunk: makeChunk(id, filePath), score, source: 'hybrid' };
}

describe('formatContext', () => {
  it('returns empty string for empty results', () => {
    expect(formatContext([], 'login')).toBe('');
  });

  it('includes the query in the output', () => {
    const out = formatContext([makeResult('handleLogin')], 'login');
    expect(out).toContain('login');
  });

  it('includes file path and line numbers in each result', () => {
    const out = formatContext([makeResult('handleLogin', 0.95, 'src/auth.ts')], 'login');
    expect(out).toContain('src/auth.ts');
    expect(out).toContain('10');
    expect(out).toContain('30');
  });

  it('includes the chunk content', () => {
    const out = formatContext([makeResult('handleLogin')], 'login');
    expect(out).toContain('function handleLogin()');
  });

  it('includes symbol name when present', () => {
    const out = formatContext([makeResult('handleLogin')], 'login');
    expect(out).toContain('handleLogin');
  });

  it('formats multiple results with rank indicators', () => {
    const results = [makeResult('fn1', 0.9), makeResult('fn2', 0.8), makeResult('fn3', 0.7)];
    const out = formatContext(results, 'query');
    expect(out).toContain('fn1');
    expect(out).toContain('fn2');
    expect(out).toContain('fn3');
  });

  it('truncates chunk content at maxCharsPerChunk', () => {
    const longChunk = makeChunk('big');
    longChunk.content = 'x'.repeat(5000);
    const result: SearchResult = { chunk: longChunk, score: 0.9, source: 'hybrid' };
    const out = formatContext([result], 'query', { maxCharsPerChunk: 100 });
    // Content should be capped; original is 5000 chars but output should be shorter
    const contentSection = out.split('big')[1];
    expect(out.length).toBeLessThan(5000);
  });

  it('wraps output in codebase_context XML tags', () => {
    const out = formatContext([makeResult('fn1')], 'auth');
    expect(out).toMatch(/^<codebase_context/);
    expect(out).toContain('</codebase_context>');
  });
});
