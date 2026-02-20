import type { InferenceBackend } from '../../src/backends/inferenceBackend.js';
import type { InferenceRequest, InferenceResponse, InferenceChunk } from '../../src/types/inference.types.js';

export class MockInferenceBackend implements InferenceBackend {
  response: InferenceResponse = { content: 'mock response', model: 'mock' };
  chunks: InferenceChunk[] = [{ content: 'mock', done: false }, { content: '', done: true }];
  shouldFail = false;
  available = true;

  async complete(_req: InferenceRequest): Promise<InferenceResponse> {
    if (this.shouldFail) throw new Error('mock failure');
    return this.response;
  }

  async *stream(_req: InferenceRequest): AsyncIterable<InferenceChunk> {
    if (this.shouldFail) throw new Error('mock failure');
    for (const chunk of this.chunks) yield chunk;
  }

  async isAvailable(): Promise<boolean> { return this.available; }
}
