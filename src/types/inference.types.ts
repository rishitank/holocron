export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface InferenceRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface InferenceResponse {
  content: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  finishReason?: string;
}

export interface InferenceChunk {
  content: string;
  done: boolean;
  model?: string;
}
