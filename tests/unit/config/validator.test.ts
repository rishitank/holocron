import { describe, it, expect } from 'vitest';
import { validateConfig, ConfigValidationError } from '../../../src/config/validator.js';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';
import type { AppConfig } from '../../../src/types/config.types.js';

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

describe('validateConfig', () => {
  it('accepts valid Ollama config without any keys', () => {
    expect(() => validateConfig(makeConfig())).not.toThrow();
  });

  it('throws when anthropic backend has no apiKey', () => {
    const config = makeConfig({
      backend: { type: 'anthropic', apiKey: '', model: 'claude-3-5-sonnet-20241022' },
    });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config)).toThrow('apiKey');
  });

  it('throws when openai-compatible has no baseUrl', () => {
    const config = makeConfig({
      backend: { type: 'openai-compatible', baseUrl: '', model: 'gpt-4' },
    });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    expect(() => validateConfig(config)).toThrow('baseUrl');
  });

  it('accepts valid anthropic config with apiKey', () => {
    const config = makeConfig({
      backend: { type: 'anthropic', apiKey: 'sk-test', model: 'claude-3-5-sonnet-20241022' },
    });
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('accepts valid openai-compatible config with baseUrl', () => {
    const config = makeConfig({
      backend: { type: 'openai-compatible', baseUrl: 'http://localhost:8000', model: 'llama3' },
    });
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('throws on invalid port', () => {
    const config = makeConfig({ api: { port: 99999, host: '127.0.0.1' } });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
  });
});
