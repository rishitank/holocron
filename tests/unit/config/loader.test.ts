import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig } from '../../../src/config/loader.js';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';

describe('loadConfig', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Clean env vars
    delete process.env['DARTH_PROXY_PORT'];
    delete process.env['DARTH_PROXY_HOST'];
    delete process.env['DARTH_LOG_LEVEL'];
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_BASE_URL'];
    delete process.env['OLLAMA_BASE_URL'];
  });

  afterEach(() => {
    delete process.env['DARTH_PROXY_PORT'];
    delete process.env['DARTH_PROXY_HOST'];
    delete process.env['DARTH_LOG_LEVEL'];
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_BASE_URL'];
    delete process.env['OLLAMA_BASE_URL'];
  });

  it('returns default config when no overrides', () => {
    const config = loadConfig('/tmp/nonexistent-dir');
    expect(config.api.port).toBe(DEFAULT_CONFIG.api.port);
    expect(config.context.mode).toBe('local');
    expect(config.backend.type).toBe('ollama');
    expect(config.logLevel).toBe('info');
  });

  it('loads without any optional env vars', () => {
    expect(() => loadConfig('/tmp/nonexistent-dir')).not.toThrow();
  });

  it('env var DARTH_PROXY_PORT overrides default port', () => {
    process.env['DARTH_PROXY_PORT'] = '9999';
    const config = loadConfig('/tmp/nonexistent-dir');
    expect(config.api.port).toBe(9999);
  });

  it('env var DARTH_LOG_LEVEL overrides log level', () => {
    process.env['DARTH_LOG_LEVEL'] = 'debug';
    const config = loadConfig('/tmp/nonexistent-dir');
    expect(config.logLevel).toBe('debug');
  });

  it('ANTHROPIC_API_KEY switches backend to anthropic', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test-key';
    const config = loadConfig('/tmp/nonexistent-dir');
    expect(config.backend.type).toBe('anthropic');
    if (config.backend.type === 'anthropic') {
      expect(config.backend.apiKey).toBe('sk-test-key');
    }
  });

  it('ANTHROPIC_BASE_URL is respected when anthropic key set', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test-key';
    process.env['ANTHROPIC_BASE_URL'] = 'http://localhost:8082';
    const config = loadConfig('/tmp/nonexistent-dir');
    expect(config.backend.type).toBe('anthropic');
    if (config.backend.type === 'anthropic') {
      expect(config.backend.baseUrl).toBe('http://localhost:8082');
    }
  });

  it('OLLAMA_BASE_URL overrides ollama backend url', () => {
    process.env['OLLAMA_BASE_URL'] = 'http://remote-host:11434';
    const config = loadConfig('/tmp/nonexistent-dir');
    expect(config.backend.type).toBe('ollama');
    if (config.backend.type === 'ollama') {
      expect(config.backend.baseUrl).toBe('http://remote-host:11434');
    }
  });
});
