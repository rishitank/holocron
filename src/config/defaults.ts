import type { AppConfig } from '../types/config.types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_CONFIG: AppConfig = {
  context: {
    mode: 'local',
    embedder: 'ollama',
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaEmbedModel: 'qwen3-embedding',
    chunker: 'ast',
    vectorStore: 'sqlite',
    persistPath: join(homedir(), '.holocron', 'index.db'),
    lazyIndexing: true,
    hierarchical: false,
    watchMode: false,
    watchDebounceMs: 500,
  },
  backend: {
    type: 'ollama',
    baseUrl: 'http://localhost:11434',
    model: 'codellama',
  },
  api: {
    port: 3666,
    host: '127.0.0.1',
  },
  enhancer: {
    maxContextResults: 5,
    contextPlacement: 'prefix',
    injectAsAdditionalContext: true,
    maxCharsPerChunk: 2000,
  },
  plugin: {
    hookScript: 'holocron hook user-prompt-submit',
    sessionStartScript: 'holocron hook session-start',
  },
  logLevel: 'info',
};
