import type { SearchResult } from '../types/context.types.js';

// ── Request schemas ──────────────────────────────────────────────────────────

export interface SearchBody {
  query: string;
  topK?: number;
}

export interface EnhanceBody {
  prompt: string;
  placement?: 'prefix' | 'suffix' | 'both';
  maxResults?: number;
}

export interface AskBody {
  question: string;
  topK?: number;
}

export interface IndexDirBody {
  directory: string;
}

// ── Response schemas ─────────────────────────────────────────────────────────

export interface SearchResponse {
  results: SearchResult[];
  formatted: string;
}

export interface EnhanceResponse {
  originalPrompt: string;
  enhancedPrompt: string;
  injectedContext: string;
  sources: SearchResult[];
}

export interface AskResponse {
  answer: string;
}

export interface IndexDirResponse {
  indexedFiles: number;
  chunks: number;
  directory: string;
}
