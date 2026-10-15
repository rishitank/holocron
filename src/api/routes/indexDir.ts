import type { FastifyInstance } from 'fastify';
import type { ContextEngine } from '../../context/contextEngine.js';
import type { IndexDirBody, IndexDirResponse } from '../schemas.js';
import { canonicalRoots, resolveAllowedDirectory } from '../rootGuard.js';

/**
 * POST /index. The directory comes from the request body, so it is only
 * indexed when it lies inside one of `allowedRoots` (`holocron serve
 * --allow-root`, default: the directory the server was started in).
 */
export function registerIndexDirRoute(
  app: FastifyInstance,
  contextEngine: ContextEngine,
  allowedRoots: readonly string[],
): void {
  app.post<{ Body: IndexDirBody; Reply: IndexDirResponse }>('/index', async (req, reply) => {
    const { directory } = req.body;
    if (!directory || typeof directory !== 'string') {
      return reply
        .status(400)
        .send({ error: 'directory is required' } as unknown as IndexDirResponse);
    }
    const target = await resolveAllowedDirectory(directory, await canonicalRoots(allowedRoots));
    if (target === null) {
      return reply.status(403).send({
        error: 'directory must be an existing directory inside an allowed root (holocron serve --allow-root)',
      } as unknown as IndexDirResponse);
    }
    const result = await contextEngine.indexDirectory(target);
    return reply.send({
      indexedFiles: result.indexedFiles,
      chunks: result.chunks,
      directory,
    });
  });
}
