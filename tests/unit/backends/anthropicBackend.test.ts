import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AnthropicBackend } from '../../../src/backends/anthropicBackend.js';
import { BackendError } from '../../../src/errors/backend.js';
import type { InferenceRequest } from '../../../src/types/inference.types.js';

function makeRequest(overrides?: Partial<InferenceRequest>): InferenceRequest {
  return {
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ],
    ...overrides,
  };
}

function mockFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
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

describe('AnthropicBackend', () => {
  let backend: AnthropicBackend;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    delete process.env['ANTHROPIC_BASE_URL'];
    backend = new AnthropicBackend({
      type: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['ANTHROPIC_BASE_URL'];
  });

  describe('complete()', () => {
    it('sends to correct endpoint with system message extracted', async () => {
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse({
          content: [{ type: 'text', text: 'Hi there' }],
          model: 'claude-sonnet-4-20250514',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      );

      const result = await backend.complete(makeRequest());

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({ method: 'POST' }),
      );

      const parsed = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(parsed.system).toBe('You are helpful.');
      expect(parsed.messages).toEqual([
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ]);

      expect(result.content).toBe('Hi there');
      expect(result.model).toBe('claude-sonnet-4-20250514');
      expect(result.inputTokens).toBe(10);
      expect(result.outputTokens).toBe(5);
    });

    it('sends x-api-key and anthropic-version headers', async () => {
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse({
          content: [{ type: 'text', text: 'ok' }],
          model: 'claude-sonnet-4-20250514',
        }),
      );

      await backend.complete(makeRequest());

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers['x-api-key']).toBe('test-key');
      expect(headers['anthropic-version']).toBe('2023-06-01');
    });

    it('throws BackendError on non-OK response', async () => {
      fetchMock.mockResolvedValueOnce(mockFetchResponse({}, false, 400));

      await expect(backend.complete(makeRequest())).rejects.toThrow(BackendError);
    });
  });

  describe('ANTHROPIC_BASE_URL env var', () => {
    it('overrides endpoint when set', async () => {
      process.env['ANTHROPIC_BASE_URL'] = 'http://localhost:8080';

      const customBackend = new AnthropicBackend({
        type: 'anthropic',
        apiKey: 'test-key',
        model: 'claude-sonnet-4-20250514',
      });

      fetchMock.mockResolvedValueOnce(
        mockFetchResponse({
          content: [{ type: 'text', text: 'ok' }],
          model: 'claude-sonnet-4-20250514',
        }),
      );

      await customBackend.complete(makeRequest());

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8080/v1/messages',
        expect.anything(),
      );
    });
  });
});
