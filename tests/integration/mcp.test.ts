import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../src/mcp/server.js';
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

describe('MCP Server Integration', () => {
  let engine: MockContextEngine;
  let backend: MockInferenceBackend;
  let client: Client;

  beforeEach(async () => {
    engine = new MockContextEngine();
    backend = new MockInferenceBackend();

    const server = createMcpServer({ contextEngine: engine, inferenceBackend: backend });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
  });

  // ── Tools ──────────────────────────────────────────────────────────────────

  describe('search_codebase tool', () => {
    it('returns formatted results when context engine finds matches', async () => {
      engine.searchResults = [makeResult('r1', 'function login() {}')];
      const result = await client.callTool({
        name: 'search_codebase',
        arguments: { query: 'login handler' },
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('login handler');
      expect(text).toContain('src/foo.ts');
    });

    it('returns no-results message when engine returns empty', async () => {
      engine.searchResults = [];
      const result = await client.callTool({
        name: 'search_codebase',
        arguments: { query: 'unknown xyz' },
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('No results found');
    });

    it('returns isError true when engine throws', async () => {
      engine.shouldThrow = true;
      const result = await client.callTool({
        name: 'search_codebase',
        arguments: { query: 'anything' },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('Search failed');
    });

    it('passes topK to the context engine', async () => {
      engine.searchResults = [makeResult('r1')];
      await client.callTool({
        name: 'search_codebase',
        arguments: { query: 'test', topK: 10 },
      });
      expect(engine.lastSearchOptions?.maxResults).toBe(10);
    });

    it('returns isError true when query argument is missing', async () => {
      const result = await client.callTool({ name: 'search_codebase', arguments: {} });
      expect(result.isError).toBe(true);
    });
  });

  describe('enhance_prompt tool', () => {
    it('returns enhanced prompt when context is available', async () => {
      engine.searchResults = [makeResult('r1', 'function login() {}')];
      const result = await client.callTool({
        name: 'enhance_prompt',
        arguments: { prompt: 'how does auth work?' },
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('how does auth work?');
      expect(text).toContain('codebase_context');
    });

    it('returns original prompt when no context found', async () => {
      engine.searchResults = [];
      const result = await client.callTool({
        name: 'enhance_prompt',
        arguments: { prompt: 'hello world' },
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toBe('hello world');
    });

    it('returns isError true when engine throws', async () => {
      engine.shouldThrow = true;
      const result = await client.callTool({
        name: 'enhance_prompt',
        arguments: { prompt: 'anything' },
      });
      expect(result.isError).toBe(true);
    });

    it('returns isError true when prompt argument is missing', async () => {
      const result = await client.callTool({ name: 'enhance_prompt', arguments: {} });
      expect(result.isError).toBe(true);
    });
  });

  describe('index_directory tool', () => {
    it('returns indexed file count on success', async () => {
      engine.indexResult = { indexedFiles: 42, chunks: 210 };
      const result = await client.callTool({
        name: 'index_directory',
        arguments: { directory: '/some/path' },
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('42');
      expect(text).toContain('/some/path');
    });

    it('returns isError true when indexing fails', async () => {
      engine.shouldThrow = true;
      const result = await client.callTool({
        name: 'index_directory',
        arguments: { directory: '/bad/path' },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('Index failed');
    });

    it('returns isError true when directory argument is missing', async () => {
      const result = await client.callTool({ name: 'index_directory', arguments: {} });
      expect(result.isError).toBe(true);
    });
  });

  describe('ask_codebase tool', () => {
    it('returns LLM answer grounded in codebase context', async () => {
      engine.searchResults = [makeResult('r1')];
      backend.response = { content: 'The answer is 42.', model: 'test' };
      const result = await client.callTool({
        name: 'ask_codebase',
        arguments: { question: 'what is login?' },
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('The answer is 42.');
    });

    it('returns error when no inference backend configured', async () => {
      const serverNoBackend = createMcpServer({ contextEngine: engine });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await serverNoBackend.connect(st);
      const c2 = new Client({ name: 'c2', version: '1.0.0' });
      await c2.connect(ct);

      const result = await c2.callTool({
        name: 'ask_codebase',
        arguments: { question: 'anything' },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('No inference backend');
      await c2.close();
    });

    it('returns isError true when backend throws', async () => {
      engine.searchResults = [makeResult('r1')];
      backend.shouldFail = true;
      const result = await client.callTool({
        name: 'ask_codebase',
        arguments: { question: 'anything' },
      });
      expect(result.isError).toBe(true);
    });

    it('returns isError true when question argument is missing', async () => {
      const result = await client.callTool({ name: 'ask_codebase', arguments: {} });
      expect(result.isError).toBe(true);
    });
  });

  // ── Resources ─────────────────────────────────────────────────────────────

  describe('index-status resource', () => {
    it('lists the index status resource', async () => {
      const { resources } = await client.listResources();
      const uris = resources.map((r) => r.uri);
      expect(uris).toContain('darth-proxy://index/status');
    });

    it('returns initial unindexed status', async () => {
      const res = await client.readResource({ uri: 'darth-proxy://index/status' });
      const status = JSON.parse((res.contents[0] as { text: string }).text);
      expect(status.indexed).toBe(false);
      expect(status.files).toBe(0);
      expect(status.lastSHA).toBeNull();
    });

    it('reflects updated status after index_directory succeeds', async () => {
      engine.indexResult = { indexedFiles: 7, chunks: 35 };
      await client.callTool({
        name: 'index_directory',
        arguments: { directory: '/repo' },
      });
      const res = await client.readResource({ uri: 'darth-proxy://index/status' });
      const status = JSON.parse((res.contents[0] as { text: string }).text);
      expect(status.indexed).toBe(true);
      expect(status.files).toBe(7);
      expect(status.lastIndexedAt).toBeTruthy();
    });
  });

  // ── Prompts ───────────────────────────────────────────────────────────────

  describe('code_context prompt', () => {
    it('lists the code_context prompt', async () => {
      const { prompts } = await client.listPrompts();
      const names = prompts.map((p) => p.name);
      expect(names).toContain('code_context');
    });

    it('returns messages with formatted context for a query', async () => {
      engine.searchResults = [makeResult('r1', 'function auth() {}')];
      const result = await client.getPrompt({
        name: 'code_context',
        arguments: { query: 'authentication', maxResults: '3' },
      });
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      const content = result.messages[0].content as { type: string; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toContain('authentication');
    });

    it('returns no-context message when engine returns empty', async () => {
      engine.searchResults = [];
      const result = await client.getPrompt({
        name: 'code_context',
        arguments: { query: 'obscure query xyz' },
      });
      expect(result.messages[0].content).toMatchObject({
        type: 'text',
        text: expect.stringContaining('No codebase context found'),
      });
    });
  });

  // ── Tool listing ──────────────────────────────────────────────────────────

  describe('tool registry', () => {
    it('lists all 4 expected tools', async () => {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('search_codebase');
      expect(names).toContain('enhance_prompt');
      expect(names).toContain('index_directory');
      expect(names).toContain('ask_codebase');
    });
  });
});
