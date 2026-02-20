export interface Chunk {
  id: string;
  content: string;
  filePath: string;
  startLine: number;
  endLine: number;
  language: string;
  symbolName?: string;
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
  source: 'bm25' | 'vector' | 'hybrid';
}

export interface IndexResult {
  indexedFiles: number;
  chunks: number;
}

export interface IndexOptions {
  incremental?: boolean;
  maxFileSizeBytes?: number;
}

export interface SearchOptions {
  maxResults?: number;
  directory?: string;
  languages?: string[];
  minScore?: number;
}

export interface IndexStats {
  totalFiles: number;
  totalChunks: number;
  lastIndexedAt?: Date;
  lastIndexedSHA?: string;
  sizeBytes?: number;
}
