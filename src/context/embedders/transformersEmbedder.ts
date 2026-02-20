import type { EmbeddingProvider } from './embeddingProvider.js';
import { NoopEmbeddingProvider } from './embeddingProvider.js';

export class TransformersEmbedder implements EmbeddingProvider {
  private _dimensions = 384;
  private pipeline: ((text: string) => Promise<{ data: Float32Array }>) | null = null;
  private readonly fallback = new NoopEmbeddingProvider();
  private available = false;

  get dimensions(): number {
    return this.available ? this._dimensions : 0;
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.available) {
      return this.fallback.embed(text);
    }
    const pipe = await this.getPipeline();
    if (!pipe) {
      return this.fallback.embed(text);
    }
    const output = await pipe(text);
    this._dimensions = output.data.length;
    return output.data;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await import('@xenova/transformers');
      this.available = true;
      return true;
    } catch {
      return false;
    }
  }

  private async getPipeline(): Promise<((text: string) => Promise<{ data: Float32Array }>) | null> {
    if (this.pipeline) return this.pipeline;
    try {
      const { pipeline } = await import('@xenova/transformers') as {
        pipeline: (task: string, model: string) => Promise<(text: string) => Promise<{ data: Float32Array }>>;
      };
      this.pipeline = await pipeline('feature-extraction', 'Xenova/nomic-embed-text-v1');
      return this.pipeline;
    } catch {
      return null;
    }
  }
}
