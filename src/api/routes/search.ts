import type { FastifyInstance } from 'fastify';
import type { ContextEngine } from '../../context/contextEngine.js';
import { formatContext } from '../../enhancers/contextFormatter.js';
import type { SearchBody, SearchResponse } from '../schemas.js';

export function registerSearchRoute(app: FastifyInstance, contextEngine: ContextEngine): void {
  app.post<{ Body: SearchBody; Reply: SearchResponse }>('/search', async (req, reply) => {
    const { query, topK } = req.body;
    if (!query || typeof query !== 'string') {
      return reply.status(400).send({ error: 'query is required' } as unknown as SearchResponse);
    }
    const results = await contextEngine.search(query, { maxResults: topK ?? 5 });
    const formatted = formatContext(results, query);
    return reply.send({ results, formatted });
  });
}
