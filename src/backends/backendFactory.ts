import type { BackendConfig } from '../types/config.types.js';
import type { InferenceBackend } from './inferenceBackend.js';
import { OllamaBackend } from './ollamaBackend.js';
import { AnthropicBackend } from './anthropicBackend.js';
import { OpenAICompatibleBackend } from './openaiCompatibleBackend.js';

export function createBackend(config: BackendConfig): InferenceBackend {
  switch (config.type) {
    case 'ollama':
      return new OllamaBackend(config);
    case 'anthropic':
      return new AnthropicBackend(config);
    case 'openai-compatible':
      return new OpenAICompatibleBackend(config);
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unknown backend type: ${(_exhaustive as { type: string }).type}`);
    }
  }
}
