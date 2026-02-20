import type { ContextEngine } from '../context/contextEngine.js';
import type { SearchResult } from '../types/context.types.js';
import { formatContext, type FormatOptions } from './contextFormatter.js';

export interface EnhanceOptions extends FormatOptions {
  placement?: 'prefix' | 'suffix' | 'both';
  maxResults?: number;
}

export interface EnhancedPrompt {
  originalPrompt: string;
  enhancedPrompt: string;
  injectedContext: string;
  sources: SearchResult[];
}

export class PromptEnhancer {
  constructor(private readonly contextEngine: ContextEngine) {}

  async enhance(prompt: string, options: EnhanceOptions = {}): Promise<EnhancedPrompt> {
    const maxResults = options.maxResults ?? 5;
    const placement = options.placement ?? 'prefix';

    const allResults = await this.contextEngine.search(prompt, { maxResults: maxResults * 2 });
    const sources = allResults.slice(0, maxResults);

    const injectedContext = formatContext(sources, prompt, {
      ...(options.maxCharsPerChunk !== undefined && { maxCharsPerChunk: options.maxCharsPerChunk }),
    });

    let enhancedPrompt: string;
    if (!injectedContext) {
      enhancedPrompt = prompt;
    } else if (placement === 'prefix') {
      enhancedPrompt = `${injectedContext}\n\n${prompt}`;
    } else if (placement === 'suffix') {
      enhancedPrompt = `${prompt}\n\n${injectedContext}`;
    } else {
      // 'both'
      enhancedPrompt = `${injectedContext}\n\n${prompt}\n\n${injectedContext}`;
    }

    return { originalPrompt: prompt, enhancedPrompt, injectedContext, sources };
  }
}
