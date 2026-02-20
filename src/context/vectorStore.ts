export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: Record<string, string>;
}

export interface VectorStore {
  add(id: string, vector: Float32Array, metadata: Record<string, string>): Promise<void>;
  search(query: Float32Array, topK: number): Promise<VectorSearchResult[]>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  readonly size: Promise<number>;
  close(): Promise<void>;
}
