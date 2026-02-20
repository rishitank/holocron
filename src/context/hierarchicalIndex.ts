import type { SearchResult } from '../types/context.types.js';
import type { VectorStore } from './vectorStore.js';
import type { EmbeddingProvider } from './embedders/embeddingProvider.js';

/**
 * HierarchicalIndex — RAPTOR-style hierarchical index for million-LOC codebases.
 *
 * Phase 2 (post-MVP) implementation. The interface is scaffolded here so that
 * LocalContextAdapter can slot it in cleanly when config.hierarchical = true.
 *
 * Architecture:
 *   raw chunks → file summaries (via LLM sampling) → module summaries → project summary
 *
 * Search traverses the tree:
 *   project summary → matching modules → matching file summaries → raw chunks
 *
 * This collapses O(n_chunks) search into O(log n) traversal for large repos.
 */
export interface SummaryNode {
  id: string;
  level: 'chunk' | 'file' | 'module' | 'project';
  content: string;
  childIds: string[];
  parentId?: string;
  metadata: Record<string, string>;
}

export type Summarizer = (text: string) => Promise<string>;

export class HierarchicalIndex {
  constructor(
    private readonly vectorStore: VectorStore,
    private readonly embedder: EmbeddingProvider,
    private readonly summarizer?: Summarizer,
  ) {}

  /**
   * Build one level of the hierarchy from the provided text nodes.
   * Groups nodes, summarizes each group, embeds summaries, and stores.
   *
   * @param nodes  Source text + metadata items to cluster
   * @param groupSize  How many nodes to combine into one summary (default 10)
   */
  async buildLevel(
    nodes: Array<{ id: string; content: string; metadata: Record<string, string> }>,
    groupSize = 10,
  ): Promise<SummaryNode[]> {
    if (!this.summarizer) return [];

    const summaries: SummaryNode[] = [];

    for (let i = 0; i < nodes.length; i += groupSize) {
      const group = nodes.slice(i, i + groupSize);
      const combined = group.map((n) => n.content).join('\n\n---\n\n');
      const summaryText = await this.summarizer(combined);

      const node: SummaryNode = {
        id: `summary-${i}-${Date.now()}`,
        level: 'file',
        content: summaryText,
        childIds: group.map((n) => n.id),
        metadata: {},
      };

      if (this.embedder.dimensions > 0) {
        const vec = await this.embedder.embed(summaryText);
        await this.vectorStore.add(node.id, vec, { level: node.level, ...node.metadata });
      }

      summaries.push(node);
    }

    return summaries;
  }

  /**
   * Search the hierarchy. Currently falls back to flat vector search.
   * Full hierarchical traversal is Phase 2.
   */
  async search(query: string): Promise<SearchResult[]> {
    if (this.embedder.dimensions === 0) return [];

    const vec = await this.embedder.embed(query);
    const hits = await this.vectorStore.search(vec, 20);

    return hits.map((h) => ({
      chunk: {
        id: h.id,
        content: '',
        filePath: h.metadata['filePath'] ?? '',
        startLine: 0,
        endLine: 0,
        language: 'text',
      },
      score: h.score,
      source: 'vector' as const,
    }));
  }
}
