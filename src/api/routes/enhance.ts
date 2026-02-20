import type { FastifyInstance } from 'fastify';
import type { ContextEngine } from '../../context/contextEngine.js';
import { PromptEnhancer } from '../../enhancers/promptEnhancer.js';
import type { EnhanceBody, EnhanceResponse } from '../schemas.js';

export function registerEnhanceRoute(app: FastifyInstance, contextEngine: ContextEngine): void {
  app.post<{ Body: EnhanceBody; Reply: EnhanceResponse }>('/enhance', async (req, reply) => {
    const { prompt, placement, maxResults } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      return reply.status(400).send({ error: 'prompt is required' } as unknown as EnhanceResponse);
    }
    const enhancer = new PromptEnhancer(contextEngine);
    const result = await enhancer.enhance(prompt, {
      placement: placement ?? 'prefix',
      maxResults: maxResults ?? 5,
    });
    return reply.send({
      originalPrompt: result.originalPrompt,
      enhancedPrompt: result.enhancedPrompt,
      injectedContext: result.injectedContext,
      sources: result.sources,
    });
  });
}
