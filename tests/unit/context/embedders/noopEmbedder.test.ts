import { describe, it, expect } from 'vitest';
import { NoopEmbeddingProvider } from '../../../../src/context/embedders/embeddingProvider.js';

describe('NoopEmbeddingProvider', () => {
  it('embed returns empty Float32Array', async () => {
    const provider = new NoopEmbeddingProvider();
    const result = await provider.embed('any text');
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(0);
  });

  it('dimensions returns 0', () => {
    const provider = new NoopEmbeddingProvider();
    expect(provider.dimensions).toBe(0);
  });

  it('isAvailable returns true', async () => {
    const provider = new NoopEmbeddingProvider();
    expect(await provider.isAvailable()).toBe(true);
  });
});
