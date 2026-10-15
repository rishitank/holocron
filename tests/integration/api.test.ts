import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi, type MockInstance } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApiServer } from '../../src/api/server.js';
import { MockContextEngine } from '../fixtures/mockContextEngine.js';
import { MockInferenceBackend } from '../fixtures/mockInferenceBackend.js';
import type { Chunk, SearchResult } from '../../src/types/context.types.js';

function makeResult(id: string, content = 'function foo() {}'): SearchResult {
  const chunk: Chunk = {
    id,
    content,
    filePath: 'src/foo.ts',
    startLine: 1,
    endLine: 5,
    language: 'typescript',
    symbolName: 'foo',
  };
  return { chunk, score: 0.9, source: 'hybrid' };
}

describe('REST API Integration', () => {
  let engine: MockContextEngine;
  let backend: MockInferenceBackend;
  let app: FastifyInstance;

  beforeEach(async () => {
    engine = new MockContextEngine();
    backend = new MockInferenceBackend();
    app = createApiServer({ contextEngine: engine, inferenceBackend: backend });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── POST /search ───────────────────────────────────────────────────────────

  describe('POST /search', () => {
    it('200 with results and formatted context', async () => {
      engine.searchResults = [makeResult('r1', 'function login() {}')];
      const res = await app.inject({
        method: 'POST',
        url: '/search',
        payload: { query: 'login handler' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results).toHaveLength(1);
      expect(body.formatted).toContain('login handler');
    });

    it('200 with empty results array when no matches', async () => {
      engine.searchResults = [];
      const res = await app.inject({
        method: 'POST',
        url: '/search',
        payload: { query: 'nothing here' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results).toHaveLength(0);
    });

    it('400 when query is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/search',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('500 when engine throws', async () => {
      engine.shouldThrow = true;
      const res = await app.inject({
        method: 'POST',
        url: '/search',
        payload: { query: 'anything' },
      });
      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /enhance ──────────────────────────────────────────────────────────

  describe('POST /enhance', () => {
    it('200 with enhanced prompt containing codebase context', async () => {
      engine.searchResults = [makeResult('r1', 'function login() {}')];
      const res = await app.inject({
        method: 'POST',
        url: '/enhance',
        payload: { prompt: 'how does auth work?' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.originalPrompt).toBe('how does auth work?');
      expect(body.enhancedPrompt).toContain('how does auth work?');
      expect(body.enhancedPrompt).toContain('codebase_context');
      expect(body.sources).toHaveLength(1);
    });

    it('200 with original prompt unchanged when no context', async () => {
      engine.searchResults = [];
      const res = await app.inject({
        method: 'POST',
        url: '/enhance',
        payload: { prompt: 'hello world' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.enhancedPrompt).toBe('hello world');
    });

    it('400 when prompt is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/enhance',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('500 when engine throws', async () => {
      engine.shouldThrow = true;
      const res = await app.inject({
        method: 'POST',
        url: '/enhance',
        payload: { prompt: 'anything' },
      });
      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /ask ──────────────────────────────────────────────────────────────

  describe('POST /ask', () => {
    it('200 with LLM answer grounded in codebase context', async () => {
      engine.searchResults = [makeResult('r1')];
      backend.response = { content: 'The login uses JWT.', model: 'test' };
      const res = await app.inject({
        method: 'POST',
        url: '/ask',
        payload: { question: 'how does login work?' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.answer).toBe('The login uses JWT.');
    });

    it('400 when question is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/ask',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('503 when no inference backend configured', async () => {
      const appNoBackend = createApiServer({ contextEngine: engine });
      await appNoBackend.ready();
      const res = await appNoBackend.inject({
        method: 'POST',
        url: '/ask',
        payload: { question: 'anything' },
      });
      expect(res.statusCode).toBe(503);
      await appNoBackend.close();
    });

    it('500 when backend throws', async () => {
      engine.searchResults = [makeResult('r1')];
      backend.shouldFail = true;
      const res = await app.inject({
        method: 'POST',
        url: '/ask',
        payload: { question: 'anything' },
      });
      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /index ────────────────────────────────────────────────────────────

  describe('POST /index', () => {
    // Real directories: the route canonicalises the requested path and the
    // allowed roots with realpath() before deciding.
    let base: string;
    let repo: string;
    let outside: string;
    let indexApp: FastifyInstance;
    let indexSpy: MockInstance<MockContextEngine['indexDirectory']>;
    const indexedDirs = (): string[] => indexSpy.mock.calls.map((call) => call[0]);

    beforeAll(async () => {
      base = await realpath(await mkdtemp(join(tmpdir(), 'holocron-api-')));
      repo = join(base, 'repo');
      outside = join(base, 'outside');
      await mkdir(join(repo, 'src'), { recursive: true });
      await mkdir(outside);
    });

    afterAll(async () => {
      await rm(base, { recursive: true, force: true });
    });

    beforeEach(async () => {
      indexSpy = vi.spyOn(engine, 'indexDirectory');
      indexApp = createApiServer({ contextEngine: engine, allowedRoots: [repo] });
      await indexApp.ready();
    });

    afterEach(async () => {
      await indexApp.close();
    });

    it('200 with indexed file count on success', async () => {
      engine.indexResult = { indexedFiles: 15, chunks: 75 };
      const res = await indexApp.inject({
        method: 'POST',
        url: '/index',
        payload: { directory: repo },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.indexedFiles).toBe(15);
      expect(body.chunks).toBe(75);
      expect(body.directory).toBe(repo);
      expect(indexedDirs()).toEqual([repo]);
    });

    it('200 for a subdirectory of an allowed root', async () => {
      const res = await indexApp.inject({
        method: 'POST',
        url: '/index',
        payload: { directory: join(repo, 'src') },
      });
      expect(res.statusCode).toBe(200);
      expect(indexedDirs()).toEqual([join(repo, 'src')]);
    });

    it('403 for a directory outside every allowed root', async () => {
      const res = await indexApp.inject({
        method: 'POST',
        url: '/index',
        payload: { directory: outside },
      });
      expect(res.statusCode).toBe(403);
      expect(indexedDirs()).toEqual([]);
    });

    it('403 for ../ traversal out of an allowed root', async () => {
      const res = await indexApp.inject({
        method: 'POST',
        url: '/index',
        payload: { directory: join(repo, '..', 'outside') },
      });
      expect(res.statusCode).toBe(403);
      expect(indexedDirs()).toEqual([]);
    });

    it('403 for a sibling whose name only shares the root prefix', async () => {
      await mkdir(`${repo}-other`, { recursive: true });
      const res = await indexApp.inject({
        method: 'POST',
        url: '/index',
        payload: { directory: `${repo}-other` },
      });
      expect(res.statusCode).toBe(403);
      expect(indexedDirs()).toEqual([]);
    });

    it.skipIf(process.platform === 'win32')(
      '403 for a symlink inside an allowed root that points outside it',
      async () => {
        await symlink(outside, join(repo, 'escape'));
        const res = await indexApp.inject({
          method: 'POST',
          url: '/index',
          payload: { directory: join(repo, 'escape') },
        });
        expect(res.statusCode).toBe(403);
        expect(indexedDirs()).toEqual([]);
      },
    );

    it('403 for a directory that does not exist', async () => {
      const res = await indexApp.inject({
        method: 'POST',
        url: '/index',
        payload: { directory: join(repo, 'missing') },
      });
      expect(res.statusCode).toBe(403);
      expect(indexedDirs()).toEqual([]);
    });

    it('defaults the allowed root to the working directory', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/index',
        payload: { directory: outside },
      });
      expect(res.statusCode).toBe(403);
      const ok = await app.inject({
        method: 'POST',
        url: '/index',
        payload: { directory: process.cwd() },
      });
      expect(ok.statusCode).toBe(200);
    });

    it('400 when directory is missing', async () => {
      const res = await indexApp.inject({
        method: 'POST',
        url: '/index',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('500 when engine throws', async () => {
      engine.shouldThrow = true;
      const res = await indexApp.inject({
        method: 'POST',
        url: '/index',
        payload: { directory: repo },
      });
      expect(res.statusCode).toBe(500);
    });
  });
});
