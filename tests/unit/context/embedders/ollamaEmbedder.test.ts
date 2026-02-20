import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaEmbedder } from '../../../../src/context/embedders/ollamaEmbedder.js';
import { BackendError } from '../../../../src/errors/backend.js';

describe('OllamaEmbedder', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('embed sends POST to Ollama /api/embed with correct body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const embedder = new OllamaEmbedder('http://localhost:11434', 'qwen3-embedding');
    const result = await embedder.embed('function foo');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/embed',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ model: 'qwen3-embedding', input: 'function foo' }),
      }),
    );
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(3);
    expect(result[0]).toBeCloseTo(0.1, 5);
    expect(result[1]).toBeCloseTo(0.2, 5);
    expect(result[2]).toBeCloseTo(0.3, 5);
  });

  it('embed updates dimensions from actual response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[1, 2, 3, 4, 5]] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const embedder = new OllamaEmbedder('http://localhost:11434');
    await embedder.embed('test');
    expect(embedder.dimensions).toBe(5);
  });

  it('embed throws BackendError on non-OK response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });
    vi.stubGlobal('fetch', mockFetch);

    const embedder = new OllamaEmbedder('http://localhost:11434');
    await expect(embedder.embed('test')).rejects.toThrow(BackendError);
  });

  it('embed throws BackendError on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    const embedder = new OllamaEmbedder('http://localhost:11434');
    await expect(embedder.embed('test')).rejects.toThrow(BackendError);
  });

  it('isAvailable returns true when /api/tags returns 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const embedder = new OllamaEmbedder('http://localhost:11434');
    expect(await embedder.isAvailable()).toBe(true);
  });

  it('isAvailable returns false on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const embedder = new OllamaEmbedder('http://localhost:11434');
    expect(await embedder.isAvailable()).toBe(false);
  });
});
