import type { SearchResult, IndexResult, IndexOptions, SearchOptions } from '../types/context.types.js';

/**
 * ContextEngine — the central abstraction for codebase intelligence.
 *
 * Open/Closed Principle: new backends (remote, cloud, etc.) implement this
 * interface without modifying any callers.
 */
export interface ContextEngine {
  /**
   * Index all files in the given directory.
   * Implementations may use lazy/incremental indexing internally.
   */
  indexDirectory(dirPath: string, options?: IndexOptions): Promise<IndexResult>;

  /**
   * Index (or re-index) a specific list of files.
   */
  indexFiles(filePaths: string[]): Promise<void>;

  /**
   * Remove indexed entries for the given file paths.
   */
  removeFiles(filePaths: string[]): Promise<void>;

  /**
   * Semantic + keyword search over the indexed codebase.
   * Returns ranked results, most relevant first.
   */
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;

  /**
   * Drop all indexed data and reset to empty state.
   */
  clearIndex(): Promise<void>;

  /** Release any held resources (DB connections, file handles, etc.). */
  dispose(): Promise<void>;
}
