import { describe, it, expect } from 'vitest';
import {
  splitCamelCase,
  extractCodeTokens,
  normalizeQuery,
  buildContextualContent,
} from '../../../src/context/tokenizer.js';
import type { Chunk } from '../../../src/types/context.types.js';

// ── splitCamelCase ────────────────────────────────────────────────────────────

describe('splitCamelCase', () => {
  it('splits lowerCamel', () => {
    expect(splitCamelCase('handleLogin')).toBe('handle login');
  });

  it('splits PascalCase', () => {
    expect(splitCamelCase('UserRepository')).toBe('user repository');
  });

  it('splits acronym followed by word', () => {
    expect(splitCamelCase('HTMLParser')).toBe('html parser');
  });

  it('splits word followed by acronym', () => {
    expect(splitCamelCase('parseHTML')).toBe('parse html');
  });

  it('handles trailing digit', () => {
    const result = splitCamelCase('useOAuth2');
    expect(result).toContain('use');
    expect(result).toContain('auth');
  });

  it('strips leading underscores and splits the rest', () => {
    const result = splitCamelCase('_privateField');
    expect(result).toContain('private');
    expect(result).toContain('field');
    expect(result).not.toContain('_');
  });

  it('converts hyphens to spaces', () => {
    expect(splitCamelCase('kebab-case-name')).toBe('kebab case name');
  });

  it('returns lowercase output', () => {
    const result = splitCamelCase('MyComponent');
    expect(result).toBe(result.toLowerCase());
  });
});

// ── extractCodeTokens ─────────────────────────────────────────────────────────

describe('extractCodeTokens', () => {
  it('extracts camelCase tokens from code content', () => {
    const content = 'function authenticateUser(token: string): boolean { return true; }';
    const tokens = extractCodeTokens(content);
    expect(tokens).toContain('authenticate');
    expect(tokens).toContain('user');
  });

  it('extracts PascalCase class names', () => {
    const content = 'class UserRepository extends BaseClass {}';
    const tokens = extractCodeTokens(content);
    expect(tokens).toContain('user');
    expect(tokens).toContain('repository');
  });

  it('deduplicates tokens', () => {
    const content = 'function getUserName() { return getUserName(); }';
    const tokens = extractCodeTokens(content);
    const parts = tokens.split(' ');
    const unique = new Set(parts);
    expect(parts.length).toBe(unique.size);
  });

  it('returns empty string for plain lowercase content', () => {
    const content = 'function process(data) { return data; }';
    const tokens = extractCodeTokens(content);
    // No mixed-case identifiers → empty
    expect(tokens).toBe('');
  });

  it('handles multiple distinct identifiers', () => {
    const content = 'const fetchUserData = async (userId: string) => { handleError(err); }';
    const tokens = extractCodeTokens(content);
    expect(tokens).toContain('fetch');
    expect(tokens).toContain('handle');
    expect(tokens).toContain('error');
  });
});

// ── normalizeQuery ────────────────────────────────────────────────────────────

describe('normalizeQuery', () => {
  it('splits camelCase in query', () => {
    const result = normalizeQuery('authenticateUser');
    expect(result).toContain('authenticate');
    expect(result).toContain('user');
  });

  it('strips FTS5 special characters: *', () => {
    expect(normalizeQuery('auth*')).not.toContain('*');
  });

  it('strips FTS5 special characters: double quotes', () => {
    expect(normalizeQuery('"exact phrase"')).not.toContain('"');
  });

  it('strips FTS5 special characters: parentheses', () => {
    expect(normalizeQuery('(foo OR bar)')).not.toContain('(');
    expect(normalizeQuery('(foo OR bar)')).not.toContain(')');
  });

  it('strips FTS5 special characters: colon', () => {
    expect(normalizeQuery('symbol:authenticate')).not.toContain(':');
  });

  it('strips FTS5 special characters: brackets', () => {
    expect(normalizeQuery('[index]')).not.toContain('[');
    expect(normalizeQuery('[index]')).not.toContain(']');
  });

  it('handles bare * without crashing', () => {
    expect(() => normalizeQuery('*')).not.toThrow();
    // bare * normalised to empty or whitespace → returns ''
    expect(normalizeQuery('*').trim()).toBe('');
  });

  it('preserves plain lowercase words', () => {
    expect(normalizeQuery('search query')).toBe('search query');
  });

  it('trims leading/trailing whitespace', () => {
    expect(normalizeQuery('  hello world  ')).toBe('hello world');
  });
});

// ── buildContextualContent ────────────────────────────────────────────────────

describe('buildContextualContent', () => {
  function makeChunk(overrides: Partial<Chunk> = {}): Chunk {
    return {
      id: 'c1',
      content: 'function example() {}',
      filePath: 'src/example.ts',
      startLine: 1,
      endLine: 5,
      language: 'typescript',
      ...overrides,
    };
  }

  it('includes file path prefix', () => {
    const result = buildContextualContent(makeChunk());
    expect(result).toContain('File: src/example.ts');
  });

  it('includes language prefix', () => {
    const result = buildContextualContent(makeChunk({ language: 'python' }));
    expect(result).toContain('Language: python');
  });

  it('includes symbol name when present', () => {
    const result = buildContextualContent(makeChunk({ symbolName: 'example' }));
    expect(result).toContain('Symbol: example');
  });

  it('omits symbol line when symbolName is undefined', () => {
    const result = buildContextualContent(makeChunk({ symbolName: undefined }));
    expect(result).not.toContain('Symbol:');
  });

  it('includes original chunk content', () => {
    const result = buildContextualContent(makeChunk({ content: 'const x = 1;' }));
    expect(result).toContain('const x = 1;');
  });

  it('content appears after metadata header', () => {
    const chunk = makeChunk({ content: 'const x = 1;' });
    const result = buildContextualContent(chunk);
    const headerEnd = result.indexOf('\n\n');
    expect(headerEnd).toBeGreaterThan(0);
    const body = result.slice(headerEnd + 2);
    expect(body).toBe('const x = 1;');
  });
});

// ── BM25 integration: camelCase query finds chunk ─────────────────────────────

describe('searchBM25 with camelCase normalisation (integration)', () => {
  // This test exercises the full pipeline: extractCodeTokens in addBatch + normalizeQuery in searchBM25
  it('finds chunks by camelCase identifier in query', async () => {
    const { SqliteHybridStore } = await import('../../../src/context/sqliteHybridStore.js');
    const store = new SqliteHybridStore(':memory:');
    await store.ensureReady();

    const chunk = {
      id: 'auth1',
      content: 'function authenticateUser(token: string): boolean { return validate(token); }',
      filePath: 'src/auth/service.ts',
      startLine: 1,
      endLine: 5,
      language: 'typescript',
      symbolName: 'authenticateUser',
    };

    await store.addBatch([{ chunk, vector: new Float32Array(0) }]);

    // Query with camelCase identifier — normalizeQuery splits it before MATCH
    const results = await store.searchBM25('authenticateUser', 5);
    expect(results.map((r) => r.id)).toContain('auth1');

    store.close();
  });

  it('searchBM25 returns empty on bare * (no crash)', async () => {
    const { SqliteHybridStore } = await import('../../../src/context/sqliteHybridStore.js');
    const store = new SqliteHybridStore(':memory:');
    await store.ensureReady();

    await store.addBatch([{
      chunk: { id: 'c1', content: 'some content', filePath: 'f.ts', startLine: 1, endLine: 5, language: 'typescript' },
      vector: new Float32Array(0),
    }]);

    const results = await store.searchBM25('*', 5);
    expect(Array.isArray(results)).toBe(true);

    store.close();
  });
});
