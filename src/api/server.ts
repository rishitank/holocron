import Fastify, { type FastifyInstance } from 'fastify';
import type { ContextEngine } from '../context/contextEngine.js';
import type { InferenceBackend } from '../backends/inferenceBackend.js';
import { registerSearchRoute } from './routes/search.js';
import { registerEnhanceRoute } from './routes/enhance.js';
import { registerAskRoute } from './routes/ask.js';
import { registerIndexDirRoute } from './routes/indexDir.js';

export interface ApiServerDeps {
  contextEngine: ContextEngine;
  inferenceBackend?: InferenceBackend;
}

/**
 * Creates a Fastify server with all 4 routes registered.
 * Does NOT call listen() — caller must do that (or use server.inject() in tests).
 */
export function createApiServer(deps: ApiServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  registerSearchRoute(app, deps.contextEngine);
  registerEnhanceRoute(app, deps.contextEngine);
  registerAskRoute(app, deps.contextEngine, deps.inferenceBackend);
  registerIndexDirRoute(app, deps.contextEngine);

  return app;
}
