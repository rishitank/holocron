import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { ContextEngine } from '../context/contextEngine.js';
import type { InferenceBackend } from '../backends/inferenceBackend.js';
import { formatContext } from '../enhancers/contextFormatter.js';
import { PromptEnhancer } from '../enhancers/promptEnhancer.js';

export interface McpServerDeps {
  contextEngine: ContextEngine;
  inferenceBackend?: InferenceBackend;
  /** Cache for index status (lazy populated on first search). */
  indexStatus?: IndexStatus;
}

export interface IndexStatus {
  indexed: boolean;
  files: number;
  lastSHA: string | null;
  lastIndexedAt: string | null;
}

/**
 * Creates and wires up a McpServer with all tools, resources, and prompts.
 * All registrations happen before connect — caller must then call server.connect(transport).
 */
export function createMcpServer(deps: McpServerDeps): McpServer {
  const { contextEngine, inferenceBackend } = deps;

  // Mutable status visible to the index/status resource
  const status: IndexStatus = deps.indexStatus ?? {
    indexed: false,
    files: 0,
    lastSHA: null,
    lastIndexedAt: null,
  };

  const server = new McpServer({
    name: 'darth-proxy',
    version: '0.1.0',
  });

  // ── Resources ───────────────────────────────────────────────────────────

  server.resource(
    'index-status',
    'darth-proxy://index/status',
    { description: 'Current index health: indexed file count, last git SHA, last indexed timestamp.' },
    async () => ({
      contents: [
        {
          uri: 'darth-proxy://index/status',
          mimeType: 'application/json',
          text: JSON.stringify(status),
        },
      ],
    }),
  );

  // ── Prompts ──────────────────────────────────────────────────────────────

  server.prompt(
    'code_context',
    {
      query: z.string().describe('Natural-language query to retrieve code context for'),
      maxResults: z.string().optional().describe('Max number of results (default 5)'),
    },
    async ({ query, maxResults }) => {
      const top = maxResults ? parseInt(maxResults, 10) : 5;
      const results = await contextEngine.search(query, { maxResults: top });
      const formatted = formatContext(results, query);
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: formatted || `No codebase context found for: ${query}`,
            },
          },
        ],
      };
    },
  );

  // ── Tools ────────────────────────────────────────────────────────────────

  server.tool(
    'search_codebase',
    'Search the indexed codebase using BM25 + vector hybrid retrieval.',
    {
      query: z.string().describe('Natural-language search query'),
      topK: z.number().int().min(1).max(50).optional().describe('Max results (default 5)'),
      directory: z.string().optional().describe('Override working directory'),
    },
    async ({ query, topK, directory }) => {
      try {
        if (directory) {
          await contextEngine.indexDirectory(directory);
        }
        const results = await contextEngine.search(query, { maxResults: topK ?? 5 });
        const formatted = formatContext(results, query);
        return {
          content: [
            {
              type: 'text' as const,
              text: formatted || `No results found for: ${query}`,
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Search failed: ${String(err)}` }],
        };
      }
    },
  );

  server.tool(
    'enhance_prompt',
    'Inject relevant codebase context into a prompt using hybrid search.',
    {
      prompt: z.string().describe('The original prompt to enhance'),
      placement: z
        .enum(['prefix', 'suffix', 'both'])
        .optional()
        .describe('Where to inject context (default: prefix)'),
      maxResults: z.number().int().min(1).max(20).optional(),
    },
    async ({ prompt, placement, maxResults }) => {
      try {
        const enhancer = new PromptEnhancer(contextEngine);
        const result = await enhancer.enhance(prompt, {
          placement: placement ?? 'prefix',
          maxResults: maxResults ?? 5,
        });
        return {
          content: [{ type: 'text' as const, text: result.enhancedPrompt }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Enhance failed: ${String(err)}` }],
        };
      }
    },
  );

  server.tool(
    'index_directory',
    'Index a directory into the local codebase store.',
    {
      directory: z.string().describe('Absolute path to the directory to index'),
    },
    async ({ directory }) => {
      try {
        const result = await contextEngine.indexDirectory(directory);
        status.indexed = true;
        status.files = result.indexedFiles;
        status.lastIndexedAt = new Date().toISOString();
        return {
          content: [
            {
              type: 'text' as const,
              text: `Indexed ${result.indexedFiles} files (${result.chunks} chunks) from ${directory}`,
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Index failed: ${String(err)}` }],
        };
      }
    },
  );

  server.tool(
    'ask_codebase',
    'Answer a question grounded in the indexed codebase (requires inference backend).',
    {
      question: z.string().describe('The question to answer'),
      topK: z.number().int().min(1).max(20).optional(),
    },
    async ({ question, topK }) => {
      if (!inferenceBackend) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'No inference backend configured. Set up an Ollama or Anthropic backend.',
            },
          ],
        };
      }
      try {
        const enhancer = new PromptEnhancer(contextEngine);
        const enhanced = await enhancer.enhance(question, { maxResults: topK ?? 5 });
        const response = await inferenceBackend.complete({
          messages: [{ role: 'user', content: enhanced.enhancedPrompt }],
        });
        return {
          content: [{ type: 'text' as const, text: response.content }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Ask failed: ${String(err)}` }],
        };
      }
    },
  );

  return server;
}

/**
 * Starts the MCP server over stdio. Logs only to stderr.
 */
export async function startMcpServer(deps: McpServerDeps): Promise<void> {
  const server = createMcpServer(deps);
  const transport = new StdioServerTransport();
  process.stderr.write('[darth-proxy] MCP server starting on stdio\n');
  await server.connect(transport);
  process.stderr.write('[darth-proxy] MCP server connected. The Force flows.\n');
}
