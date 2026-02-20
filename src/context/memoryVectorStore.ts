import type { VectorStore, VectorSearchResult } from './vectorStore.js';

interface Entry {
  id: string;
  vector: Float32Array;
  metadata: Record<string, string>;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export class MemoryVectorStore implements VectorStore {
  private entries = new Map<string, Entry>();

  async add(id: string, vector: Float32Array, metadata: Record<string, string>): Promise<void> {
    this.entries.set(id, { id, vector, metadata });
  }

  async search(query: Float32Array, topK: number): Promise<VectorSearchResult[]> {
    if (query.length === 0) return [];

    const results: VectorSearchResult[] = [];
    for (const entry of this.entries.values()) {
      const score = cosineSimilarity(query, entry.vector);
      results.push({ id: entry.id, score, metadata: entry.metadata });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  async remove(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }

  get size(): Promise<number> {
    return Promise.resolve(this.entries.size);
  }

  async close(): Promise<void> {
    // Nothing to close for in-memory store
  }
}
