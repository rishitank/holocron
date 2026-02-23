import type { EmbeddingProvider } from './embeddingProvider.js';
import { BackendError } from '../../errors/backend.js';

interface OllamaEmbedResponse {
  embeddings: number[][];
}

export class OllamaEmbedder implements EmbeddingProvider {
  private _dimensions: number;

  constructor(
    private readonly baseUrl: string,
    private readonly model = 'qwen3-embedding',
    dimensions = 768,
  ) {
    this._dimensions = dimensions;
  }

  get dimensions(): number {
    return this._dimensions;
  }

  async embed(text: string): Promise<Float32Array> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: text }),
      });
    } catch (err) {
      throw new BackendError('Failed to connect to Ollama for embeddings', undefined, err);
    }

    if (!response.ok) {
      throw new BackendError(
        `Ollama embed request failed: ${response.status} ${response.statusText}`,
        response.status,
      );
    }

    const data = (await response.json()) as OllamaEmbedResponse;
    const embedding = data.embeddings[0];
    if (!embedding) {
      throw new BackendError('Ollama returned empty embeddings array');
    }

    // Update dimensions based on actual response
    this._dimensions = embedding.length;
    return new Float32Array(embedding);
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
