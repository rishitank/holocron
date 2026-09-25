import { describe, it, expect } from 'vitest';
import { trimTrailingSlashes } from '../../../src/backends/baseUrl.js';
import { OllamaBackend } from '../../../src/backends/ollamaBackend.js';
import { OpenAICompatibleBackend } from '../../../src/backends/openaiCompatibleBackend.js';
import { AnthropicBackend } from '../../../src/backends/anthropicBackend.js';

describe('trimTrailingSlashes', () => {
  it.each([
    ['http://localhost:11434', 'http://localhost:11434'],
    ['http://localhost:11434/', 'http://localhost:11434'],
    ['http://localhost:11434///', 'http://localhost:11434'],
    ['https://api.example.com/v1/', 'https://api.example.com/v1'],
    ['/', ''],
    ['', ''],
  ])('%j → %j', (input, expected) => {
    expect(trimTrailingSlashes(input)).toBe(expected);
  });

  // The old /\/+$/ regex was quadratic on a long run of slashes that is not
  // at the end of the string: 50k slashes took ~2.5 s with it, so 200k would
  // take ~40 s. The linear scan finishes in well under a millisecond; the
  // 50 ms bound leaves headroom for slow CI while still failing on O(n²).
  it.each([
    ['slashes then a non-slash', '/'.repeat(200_000) + 'x'],
    ['all slashes', '/'.repeat(200_000)],
    ['url then slashes then a non-slash', 'http://h' + '/'.repeat(200_000) + 'x'],
  ])('is linear on adversarial input: %s', (_label, input) => {
    const start = performance.now();
    const out = trimTrailingSlashes(input);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
    expect(out.endsWith('/')).toBe(false);
  });
});

describe('backends normalise baseUrl without a regex', () => {
  const evil = 'http://h' + '/'.repeat(200_000) + 'x';

  it.each([
    ['OllamaBackend', (): unknown => new OllamaBackend({ type: 'ollama', baseUrl: evil, model: 'm' })],
    ['OpenAICompatibleBackend', (): unknown => new OpenAICompatibleBackend({ type: 'openai-compatible', baseUrl: evil, model: 'm' })],
    ['AnthropicBackend', (): unknown => new AnthropicBackend({ type: 'anthropic', baseUrl: evil, apiKey: 'k', model: 'm' })],
  ])('%s constructs quickly with an adversarial baseUrl', (_name, make) => {
    const start = performance.now();
    make();
    expect(performance.now() - start).toBeLessThan(50);
  });
});
