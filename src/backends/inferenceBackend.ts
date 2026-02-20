import type { InferenceRequest, InferenceResponse, InferenceChunk } from '../types/inference.types.js';

export interface InferenceBackend {
  complete(request: InferenceRequest): Promise<InferenceResponse>;
  stream(request: InferenceRequest): AsyncIterable<InferenceChunk>;
  isAvailable(): Promise<boolean>;
}
