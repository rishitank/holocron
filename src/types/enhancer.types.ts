import type { SearchResult } from './context.types.js';

export interface EnhancedPrompt {
  originalPrompt: string;
  enhancedPrompt: string;
  injectedContext: string;
  sources: SearchResult[];
}

export interface EnhanceOptions {
  maxResults?: number;
  placement?: 'prefix' | 'suffix' | 'both';
  maxCharsPerChunk?: number;
}
