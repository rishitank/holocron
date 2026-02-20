import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAICompatibleBackend } from '../../../src/backends/openaiCompatibleBackend.js';
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
    statusText: ok ? 'OK' : 'Internal Server Error',
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

describe('OpenAICompatibleBackend', () => {
  let backend: OpenAICompatibleBackend;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    backend = new OpenAICompatibleBackend({
      type: 'openai-compatible',
      baseUrl: 'http://localhost:8000',
      apiKey: 'sk-test',
      model: 'gpt-4',
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
          model: 'gpt-4',
        }),
      );

      await backend.complete(makeRequest());

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8000/v1/chat/completions',
        expect.objectContaining({ method: 'POST' }),
      );

      const parsed = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(parsed.model).toBe('gpt-4');
      expect(parsed.messages).toEqual([{ role: 'user', content: 'Hello' }]);
    });

    it('maps response to InferenceResponse', async () => {
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse({
          choices: [{ message: { content: 'Hello back' }, finish_reason: 'stop' }],
          model: 'gpt-4',
          usage: { prompt_tokens: 5, completion_tokens: 3 },
        }),
      );

      const result = await backend.complete(makeRequest());

      expect(result.content).toBe('Hello back');
      expect(result.model).toBe('gpt-4');
      expect(result.inputTokens).toBe(5);
      expect(result.outputTokens).toBe(3);
      expect(result.finishReason).toBe('stop');
    });

    it('sends Authorization header with apiKey', async () => {
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse({
          choices: [{ message: { content: 'ok' } }],
          model: 'gpt-4',
        }),
      );

      await backend.complete(makeRequest());

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe('Bearer sk-test');
    });

    it('throws BackendError on non-OK response', async () => {
      fetchMock.mockResolvedValueOnce(mockFetchResponse({}, false, 500));

      await expect(backend.complete(makeRequest())).rejects.toThrow(BackendError);
    });
  });

  describe('stream()', () => {
    it('yields InferenceChunk per SSE data line and done:true on [DONE]', async () => {
      fetchMock.mockResolvedValueOnce(
        mockStreamResponse([
          'data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}],"model":"gpt-4"}',
          'data: {"choices":[{"delta":{"content":" there"},"finish_reason":null}],"model":"gpt-4"}',
          'data: [DONE]',
        ]),
      );

      const chunks: Array<{ content: string; done: boolean }> = [];
      for await (const chunk of backend.stream(makeRequest())) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        { content: 'Hi', done: false, model: 'gpt-4' },
        { content: ' there', done: false, model: 'gpt-4' },
        { content: '', done: true },
      ]);
    });

    it('stream() skips malformed SSE JSON and continues yielding valid chunks', async () => {
      fetchMock.mockResolvedValueOnce(
        mockStreamResponse([
          'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":null}],"model":"gpt-4"}',
          'data: NOT_VALID_JSON',
          'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}],"model":"gpt-4"}',
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
    it('returns true when GET /v1/models returns 200', async () => {
      fetchMock.mockResolvedValueOnce(mockFetchResponse({ data: [] }));

      const available = await backend.isAvailable();

      expect(available).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8000/v1/models',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }) }),
      );
    });

    it('returns false on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const available = await backend.isAvailable();

      expect(available).toBe(false);
    });
  });
});
