import type { ContextEngine } from '../../src/context/contextEngine.js';
import type { SearchResult, IndexResult, IndexOptions, SearchOptions } from '../../src/types/context.types.js';

/**
 * Mock ContextEngine for tests.
 * Expose mutable properties to control return values per test.
 */
export class MockContextEngine implements ContextEngine {
  searchResults: SearchResult[] = [];
  indexResult: IndexResult = { indexedFiles: 0, chunks: 0 };
  indexedFiles: string[] = [];
  removedFiles: string[] = [];
  cleared = false;
  disposed = false;
  shouldThrow = false;
  lastSearchOptions: SearchOptions | undefined = undefined;

  async indexDirectory(_dirPath: string, _options?: IndexOptions): Promise<IndexResult> {
    if (this.shouldThrow) throw new Error('mock index failure');
    return { ...this.indexResult };
  }

  async indexFiles(filePaths: string[]): Promise<void> {
    if (this.shouldThrow) throw new Error('mock index failure');
    this.indexedFiles.push(...filePaths);
  }

  async removeFiles(filePaths: string[]): Promise<void> {
    this.removedFiles.push(...filePaths);
  }

  async search(_query: string, options?: SearchOptions): Promise<SearchResult[]> {
    if (this.shouldThrow) throw new Error('mock search failure');
    this.lastSearchOptions = options;
    return [...this.searchResults];
  }

  async clearIndex(): Promise<void> {
    this.cleared = true;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }

  reset() {
    this.searchResults = [];
    this.indexResult = { indexedFiles: 0, chunks: 0 };
    this.indexedFiles = [];
    this.removedFiles = [];
    this.cleared = false;
    this.disposed = false;
    this.shouldThrow = false;
    this.lastSearchOptions = undefined;
  }
}
