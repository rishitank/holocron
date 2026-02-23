import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OllamaBackend } from '../../../src/backends/ollamaBackend.js';
import { BackendError } from '../../../src/errors/backend.js';
import type { InferenceRequest } from '../../../src/types/inference.types.js';

function makeRequest(overrides?: Partial<InferenceRequest>): InferenceRequest {
  return {
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

function mockFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Not Found',
    json: () => Promise.resolve(body),
    headers: new Headers(),
    redirected: false,
    type: 'basic',
    url: '',
    clone: () => ({}) as Response,
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    text: () => Promise.resolve(''),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

function makeSSEStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = lines.join('\n') + '\n';
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function mockStreamResponse(lines: string[]): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    body: makeSSEStream(lines),
    headers: new Headers(),
    redirected: false,
    type: 'basic',
    url: '',
    clone: () => ({}) as Response,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

describe('OllamaBackend', () => {
  let backend: OllamaBackend;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    backend = new OllamaBackend({
      type: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
    });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('complete()', () => {
    it('sends POST to correct URL with correct body', async () => {
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse({
          choices: [{ message: { content: 'Hello back' } }],
          model: 'llama3',
        }),
      );

      await backend.complete(makeRequest());

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:11434/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String),
        }),
      );

      const parsed = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(parsed.model).toBe('llama3');
      expect(parsed.messages).toEqual([{ role: 'user', content: 'Hello' }]);
      expect(parsed.stream).toBe(false);
    });

    it('maps response to InferenceResponse', async () => {
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse({
          choices: [{ message: { content: 'Hello back' } }],
          model: 'llama3',
          usage: { prompt_tokens: 5, completion_tokens: 3 },
        }),
      );

      const result = await backend.complete(makeRequest());

      expect(result.content).toBe('Hello back');
      expect(result.model).toBe('llama3');
      expect(result.inputTokens).toBe(5);
      expect(result.outputTokens).toBe(3);
    });

    it('throws BackendError on non-OK response', async () => {
      fetchMock.mockResolvedValueOnce(mockFetchResponse({}, false, 404));

      await expect(backend.complete(makeRequest())).rejects.toThrow(BackendError);
    });
  });

  describe('stream()', () => {
    it('yields InferenceChunk per SSE data line and done:true on [DONE]', async () => {
      fetchMock.mockResolvedValueOnce(
        mockStreamResponse([
          'data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}],"model":"llama3"}',
          'data: {"choices":[{"delta":{"content":" there"},"finish_reason":null}],"model":"llama3"}',
          'data: [DONE]',
        ]),
      );

      const chunks: { content: string; done: boolean }[] = [];
      for await (const chunk of backend.stream(makeRequest())) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        { content: 'Hi', done: false, model: 'llama3' },
        { content: ' there', done: false, model: 'llama3' },
        { content: '', done: true },
      ]);
    });

    it('stream() skips malformed SSE JSON and continues yielding valid chunks', async () => {
      fetchMock.mockResolvedValueOnce(
        mockStreamResponse([
          'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":null}],"model":"llama3"}',
          'data: NOT_VALID_JSON',
          'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}],"model":"llama3"}',
          'data: [DONE]',
        ]),
      );

      const chunks: string[] = [];
      for await (const chunk of backend.stream(makeRequest())) {
        chunks.push(chunk.content);
      }

      expect(chunks.filter(Boolean)).toEqual(['hello', ' world']);
    });
  });

  describe('isAvailable()', () => {
    it('returns true when GET /api/tags returns 200', async () => {
      fetchMock.mockResolvedValueOnce(mockFetchResponse({ models: [] }));

      const available = await backend.isAvailable();

      expect(available).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/api/tags');
    });

    it('returns false on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const available = await backend.isAvailable();

      expect(available).toBe(false);
    });
  });
});
