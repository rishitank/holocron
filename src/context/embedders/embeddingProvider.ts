export interface EmbeddingProvider {
  embed(text: string): Promise<Float32Array>;
  readonly dimensions: number;
  isAvailable(): Promise<boolean>;
}

export class NoopEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 0;

  embed(_text: string): Promise<Float32Array> {
    return Promise.resolve(new Float32Array(0));
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
