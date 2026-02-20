import { create, insert, search, remove, count } from '@orama/orama';
import type { Orama } from '@orama/orama';
import type { Chunk } from '../types/context.types.js';

const SCHEMA = {
  id: 'string',
  content: 'string',
  filePath: 'string',
  language: 'string',
  symbolName: 'string',
} as const;

export interface BM25Result {
  id: string;
  score: number;
  chunk: Chunk;
}

export class OramaIndex {
  private db!: Orama<typeof SCHEMA>;
  private chunkMap = new Map<string, Chunk>();
  private ready: Promise<void>;

  constructor() {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    this.db = await create({ schema: SCHEMA });
  }

  async add(chunk: Chunk): Promise<void> {
    await this.ready;
    // Remove existing doc with same id if present
    if (this.chunkMap.has(chunk.id)) {
      await remove(this.db, chunk.id);
    }
    await insert(this.db, {
      id: chunk.id,
      content: chunk.content,
      filePath: chunk.filePath,
      language: chunk.language,
      symbolName: chunk.symbolName ?? '',
    });
    this.chunkMap.set(chunk.id, chunk);
  }

  async search(query: string, topK = 10): Promise<BM25Result[]> {
    await this.ready;
    const results = await search(this.db, {
      term: query,
      limit: topK,
    });

    return results.hits
      .map((hit) => {
        const chunk = this.chunkMap.get(hit.id);
        if (!chunk) return null;
        return {
          id: hit.id,
          score: hit.score,
          chunk,
        };
      })
      .filter((r): r is BM25Result => r !== null);
  }

  async removeByFilePath(filePath: string): Promise<void> {
    await this.ready;
    const toRemove: string[] = [];
    for (const [id, chunk] of this.chunkMap) {
      if (chunk.filePath === filePath) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      await remove(this.db, id);
      this.chunkMap.delete(id);
    }
  }

  async clear(): Promise<void> {
    this.chunkMap.clear();
    this.ready = this.init();
    await this.ready;
  }

  get size(): number {
    return this.chunkMap.size;
  }

  async getSize(): Promise<number> {
    await this.ready;
    return count(this.db);
  }
}
