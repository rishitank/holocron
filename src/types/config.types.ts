export interface OllamaConfig {
  type: 'ollama';
  baseUrl: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AnthropicConfig {
  type: 'anthropic';
  apiKey: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface OpenAICompatibleConfig {
  type: 'openai-compatible';
  baseUrl: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export type BackendConfig = OllamaConfig | AnthropicConfig | OpenAICompatibleConfig;

export interface ContextConfig {
  mode: 'local' | 'augment';
  embedder: 'noop' | 'ollama' | 'transformers';
  ollamaBaseUrl?: string;
  ollamaEmbedModel?: string;
  chunker: 'ast' | 'text';
  vectorStore: 'sqlite' | 'memory';
  persistPath?: string;
  lazyIndexing: boolean;
  hierarchical: boolean;
  watchMode: boolean;
  watchDebounceMs: number;
}

export interface ApiConfig {
  port: number;
  host: string;
}

export interface EnhancerConfig {
  maxContextResults: number;
  contextPlacement: 'prefix' | 'suffix' | 'both';
  injectAsAdditionalContext: boolean;
  maxCharsPerChunk: number;
}

export interface PluginConfig {
  hookScript: string;
  sessionStartScript: string;
}

export interface AppConfig {
  context: ContextConfig;
  backend: BackendConfig;
  api: ApiConfig;
  enhancer: EnhancerConfig;
  plugin: PluginConfig;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
