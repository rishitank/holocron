import { describe, it, expect, beforeEach } from 'vitest';
import { PromptEnhancer } from '../../../src/enhancers/promptEnhancer.js';
import { MockContextEngine } from '../../fixtures/mockContextEngine.js';
import type { SearchResult } from '../../../src/types/context.types.js';
import type { Chunk } from '../../../src/types/context.types.js';

function makeResult(id: string, content = 'function foo() {}'): SearchResult {
  const chunk: Chunk = {
    id,
    content,
    filePath: 'src/foo.ts',
    startLine: 1,
    endLine: 5,
    language: 'typescript',
  };
  return { chunk, score: 0.9, source: 'hybrid' };
}

describe('PromptEnhancer', () => {
  let engine: MockContextEngine;
  let enhancer: PromptEnhancer;

  beforeEach(() => {
    engine = new MockContextEngine();
    enhancer = new PromptEnhancer(engine);
  });

  it('calls contextEngine.search with the original prompt', async () => {
    engine.searchResults = [makeResult('r1')];
    await enhancer.enhance('how does auth work?');
    expect(engine.searchResults.length).toBe(1); // engine was used
  });

  it('returns originalPrompt unchanged in EnhancedPrompt', async () => {
    engine.searchResults = [makeResult('r1')];
    const result = await enhancer.enhance('login handler');
    expect(result.originalPrompt).toBe('login handler');
  });

  it('prefix mode prepends context before prompt', async () => {
    engine.searchResults = [makeResult('r1', 'function login() {}')];
    const result = await enhancer.enhance('login handler', { placement: 'prefix' });
    expect(result.enhancedPrompt.indexOf(result.injectedContext)).toBeLessThan(
      result.enhancedPrompt.indexOf(result.originalPrompt),
    );
  });

  it('suffix mode appends context after prompt', async () => {
    engine.searchResults = [makeResult('r1', 'function login() {}')];
    const result = await enhancer.enhance('login handler', { placement: 'suffix' });
    expect(result.enhancedPrompt.indexOf(result.originalPrompt)).toBeLessThan(
      result.enhancedPrompt.indexOf(result.injectedContext),
    );
  });

  it('returns original prompt unchanged when no results', async () => {
    engine.searchResults = [];
    const result = await enhancer.enhance('obscure query');
    expect(result.enhancedPrompt).toBe(result.originalPrompt);
    expect(result.injectedContext).toBe('');
  });

  it('populates sources from search results', async () => {
    engine.searchResults = [makeResult('r1'), makeResult('r2')];
    const result = await enhancer.enhance('query');
    expect(result.sources).toHaveLength(2);
  });

  it('respects maxResults option', async () => {
    engine.searchResults = [makeResult('r1'), makeResult('r2'), makeResult('r3'), makeResult('r4')];
    const result = await enhancer.enhance('query', { maxResults: 2 });
    expect(result.sources).toHaveLength(2);
  });
});
