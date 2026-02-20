import type { ContextEngine } from './contextEngine.js';
import type { SearchResult, IndexResult, IndexOptions, SearchOptions } from '../types/context.types.js';

/**
 * Optional Augment Cloud context adapter.
 * Only used when AUGMENT_API_TOKEN is set and @augmentcode/auggie-sdk is installed.
 * Implements the same ContextEngine interface as LocalContextAdapter — fully interchangeable.
 */
export class AugmentContextAdapter implements ContextEngine {
  private client: unknown = null;

  constructor() {
    // Client is initialised lazily in indexDirectory / search
  }

  async indexDirectory(_dirPath: string, _options?: IndexOptions): Promise<IndexResult> {
    const client = await this.getClient();
    // @ts-expect-error — dynamic optional dep
    await client.index?.(_dirPath);
    return { indexedFiles: 0, chunks: 0 };
  }

  async indexFiles(_filePaths: string[]): Promise<void> {
    // Cloud adapter — no-op; indexDirectory handles full re-index when needed
  }

  async removeFiles(_filePaths: string[]): Promise<void> {
    // Cloud adapter — no-op; Augment cloud manages its own index
  }

  async clearIndex(): Promise<void> {
    // Cloud adapter — no-op
  }

  async dispose(): Promise<void> {
    this.client = null;
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const client = await this.getClient();
    // @ts-expect-error — dynamic optional dep
    const raw = await client.search?.(query, { topK: options?.maxResults ?? 5 });
    if (!Array.isArray(raw)) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return raw.map((r: any) => ({
      chunk: {
        id: r.id ?? String(Math.random()),
        content: r.content ?? '',
        filePath: r.filePath ?? '',
        startLine: r.startLine ?? 0,
        endLine: r.endLine ?? 0,
        language: r.language ?? 'text',
        ...(r.symbolName !== undefined && { symbolName: r.symbolName }),
      },
      score: r.score ?? 0,
      source: 'vector' as const,
    }));
  }

  private async getClient(): Promise<unknown> {
    if (this.client) return this.client;
    const { DirectContext } = await import('@augmentcode/auggie-sdk');
    this.client = await DirectContext.create({ apiKey: process.env['AUGMENT_API_TOKEN'] ?? '' });
    return this.client;
  }
}
