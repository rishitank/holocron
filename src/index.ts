// Public API — explicit named exports only (no re-export *)

export type { ContextEngine } from './context/contextEngine.js';
export type { InferenceBackend } from './backends/inferenceBackend.js';
export type { EnhancedPrompt, EnhanceOptions } from './enhancers/promptEnhancer.js';
export type { SearchResult, IndexResult, Chunk } from './types/context.types.js';
export type { InferenceResponse, InferenceRequest, ChatMessage } from './types/inference.types.js';

export { LocalContextAdapter } from './context/localContextAdapter.js';
export { PromptEnhancer } from './enhancers/promptEnhancer.js';
export { formatContext } from './enhancers/contextFormatter.js';
export { createContextEngine } from './context/index.js';
export { createBackend } from './backends/backendFactory.js';
export { createMcpServer, startMcpServer } from './mcp/server.js';
export { createApiServer } from './api/server.js';
