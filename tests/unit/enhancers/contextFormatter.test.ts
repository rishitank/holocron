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

function makeResult(
  id: string,
  score = 0.9,
  filePath = 'src/auth.ts',
  content?: string,
  language = 'typescript',
): SearchResult {
  const chunk = makeChunk(id, filePath);
  if (content !== undefined) chunk.content = content;
  if (language !== 'typescript') chunk.language = language;
  return { chunk, score, source: 'hybrid' };
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
    const results = [makeResult('fn1', 0.9), makeResult('fn2', 0.8, 'src/b.ts'), makeResult('fn3', 0.7, 'src/c.ts')];
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
    expect(out.length).toBeLessThan(5000);
  });

  it('wraps output in codebase_context XML tags', () => {
    const out = formatContext([makeResult('fn1')], 'auth');
    expect(out).toMatch(/^<codebase_context/);
    expect(out).toContain('</codebase_context>');
  });

  // --- New tests for Phase 3 improvements ---

  it('includes language attribute in result tag', () => {
    const results = [makeResult('idx', 0.85, 'src/index.ts', 'const x = 1;', 'typescript')];
    const output = formatContext(results, 'test query');
    expect(output).toContain('language="typescript"');
  });

  it('truncates at line boundary', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}: ${'x'.repeat(30)}`);
    const content = lines.join('\n');
    const results = [makeResult('big', 0.9, 'src/big.ts', content)];
    const output = formatContext(results, 'query', { maxCharsPerChunk: 500 });

    expect(output).toContain('... [truncated]');
    // Extract the content between the result tags
    const resultMatch = output.match(/<result[^>]*>\n([\s\S]*?)\n<\/result>/);
    expect(resultMatch).not.toBeNull();
    const truncatedContent = resultMatch![1];
    // The line before "... [truncated]" should be a complete line
    const beforeTruncation = truncatedContent.split('\n... [truncated]')[0];
    const lastLine = beforeTruncation.split('\n').pop()!;
    expect(lastLine).toMatch(/^line \d+:/);
  });

  it('filters results below relevance threshold', () => {
    const results = [
      makeResult('low', 0.3, 'src/a.ts', 'low score content'),
      makeResult('high', 0.8, 'src/b.ts', 'high score content'),
    ];
    const output = formatContext(results, 'query', { relevanceThreshold: 0.5 });

    expect(output).toContain('high score content');
    expect(output).not.toContain('low score content');
    expect(output).toContain('results="1"');
  });

  it('caps results per file', () => {
    const results = [
      makeResult('a', 0.9, 'src/same.ts', 'first chunk'),
      makeResult('b', 0.8, 'src/same.ts', 'second chunk'),
      makeResult('c', 0.7, 'src/same.ts', 'third chunk'),
    ];
    const output = formatContext(results, 'query', { maxResultsPerFile: 2 });

    expect(output).toContain('first chunk');
    expect(output).toContain('second chunk');
    expect(output).not.toContain('third chunk');
    expect(output).toContain('results="2"');
  });

  it('deduplicates results by content', () => {
    const sharedContent = 'x'.repeat(250); // same first 200 chars
    const results = [
      makeResult('a', 0.9, 'src/a.ts', sharedContent),
      makeResult('b', 0.8, 'src/b.ts', sharedContent),
    ];
    const output = formatContext(results, 'query');

    expect(output).toContain('results="1"');
    expect(output).toContain('src/a.ts');
    expect(output).not.toContain('src/b.ts');
  });

  it('returns empty string when all results are below threshold', () => {
    const results = [
      makeResult('a', 0.01, 'src/a.ts', 'weak'),
      makeResult('b', 0.02, 'src/b.ts', 'weaker'),
    ];
    const output = formatContext(results, 'query', { relevanceThreshold: 0.5 });
    expect(output).toBe('');
  });
});
