export interface EmbeddingProvider {
  embed(text: string): Promise<Float32Array>;
  readonly dimensions: number;
  isAvailable(): Promise<boolean>;
}

export class NoopEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 0;

  async embed(_text: string): Promise<Float32Array> {
    return new Float32Array(0);
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
