import { describe, it, expect } from 'vitest';
import { createBackend } from '../../../src/backends/backendFactory.js';
import { OllamaBackend } from '../../../src/backends/ollamaBackend.js';
import { AnthropicBackend } from '../../../src/backends/anthropicBackend.js';
import { OpenAICompatibleBackend } from '../../../src/backends/openaiCompatibleBackend.js';

describe('createBackend', () => {
  it('creates OllamaBackend for ollama config', () => {
    const backend = createBackend({
      type: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
    });
    expect(backend).toBeInstanceOf(OllamaBackend);
  });

  it('creates AnthropicBackend for anthropic config', () => {
    const backend = createBackend({
      type: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });
    expect(backend).toBeInstanceOf(AnthropicBackend);
  });

  it('creates OpenAICompatibleBackend for openai-compatible config', () => {
    const backend = createBackend({
      type: 'openai-compatible',
      baseUrl: 'http://localhost:8000',
      model: 'gpt-4',
    });
    expect(backend).toBeInstanceOf(OpenAICompatibleBackend);
  });
});
