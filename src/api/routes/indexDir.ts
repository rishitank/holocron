import type { FastifyInstance } from 'fastify';
import type { ContextEngine } from '../../context/contextEngine.js';
import type { IndexDirBody, IndexDirResponse } from '../schemas.js';

export function registerIndexDirRoute(app: FastifyInstance, contextEngine: ContextEngine): void {
  app.post<{ Body: IndexDirBody; Reply: IndexDirResponse }>('/index', async (req, reply) => {
    const { directory } = req.body;
    if (!directory || typeof directory !== 'string') {
      return reply
        .status(400)
        .send({ error: 'directory is required' } as unknown as IndexDirResponse);
    }
    const result = await contextEngine.indexDirectory(directory);
    return reply.send({
      indexedFiles: result.indexedFiles,
      chunks: result.chunks,
      directory,
    });
  });
}
