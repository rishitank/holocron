import type { FastifyInstance } from 'fastify';
import type { ContextEngine } from '../../context/contextEngine.js';
import type { InferenceBackend } from '../../backends/inferenceBackend.js';
import { PromptEnhancer } from '../../enhancers/promptEnhancer.js';
import type { AskBody, AskResponse } from '../schemas.js';

export function registerAskRoute(
  app: FastifyInstance,
  contextEngine: ContextEngine,
  inferenceBackend?: InferenceBackend,
): void {
  app.post<{ Body: AskBody; Reply: AskResponse }>('/ask', async (req, reply) => {
    const { question, topK } = req.body;
    if (!question || typeof question !== 'string') {
      return reply.status(400).send({ error: 'question is required' } as unknown as AskResponse);
    }
    if (!inferenceBackend) {
      return reply
        .status(503)
        .send({ error: 'No inference backend configured' } as unknown as AskResponse);
    }
    const enhancer = new PromptEnhancer(contextEngine);
    const enhanced = await enhancer.enhance(question, { maxResults: topK ?? 5 });
    const response = await inferenceBackend.complete({
      messages: [{ role: 'user', content: enhanced.enhancedPrompt }],
    });
    return reply.send({ answer: response.content });
  });
}
