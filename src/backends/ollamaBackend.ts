import type { OllamaConfig } from '../types/config.types.js';
import type { InferenceRequest, InferenceResponse, InferenceChunk } from '../types/inference.types.js';
import type { InferenceBackend } from './inferenceBackend.js';
import { BackendError } from '../errors/backend.js';

export class OllamaBackend implements InferenceBackend {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly temperature: number | undefined;
  private readonly maxTokens: number | undefined;

  constructor(config: OllamaConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.model = config.model;
    this.temperature = config.temperature;
    this.maxTokens = config.maxTokens;
  }

  async complete(request: InferenceRequest): Promise<InferenceResponse> {
    const url = `${this.baseUrl}/v1/chat/completions`;
    const body = {
      model: request.model ?? this.model,
      messages: request.messages,
      temperature: request.temperature ?? this.temperature,
      max_tokens: request.maxTokens ?? this.maxTokens,
      stream: false,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new BackendError(
        `Ollama request failed: ${res.status} ${res.statusText}`,
        res.status,
      );
    }

    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const choice = data.choices[0];
    return {
      content: choice?.message.content ?? '',
      model: data.model ?? body.model,
      ...(data.usage?.prompt_tokens !== undefined && { inputTokens: data.usage.prompt_tokens }),
      ...(data.usage?.completion_tokens !== undefined && { outputTokens: data.usage.completion_tokens }),
    };
  }

  async *stream(request: InferenceRequest): AsyncIterable<InferenceChunk> {
    const url = `${this.baseUrl}/v1/chat/completions`;
    const body = {
      model: request.model ?? this.model,
      messages: request.messages,
      temperature: request.temperature ?? this.temperature,
      max_tokens: request.maxTokens ?? this.maxTokens,
      stream: true,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new BackendError(
        `Ollama stream failed: ${res.status} ${res.statusText}`,
        res.status,
      );
    }

    if (!res.body) {
      throw new BackendError('No response body for stream');
    }

    const reader = res.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;

          const payload = trimmed.slice(6);
          if (payload === '[DONE]') {
            yield { content: '', done: true };
            return;
          }

          let parsed: {
            choices: { delta: { content?: string }; finish_reason?: string | null }[];
            model?: string;
          };
          try {
            parsed = JSON.parse(payload) as typeof parsed;
          } catch {
            continue; // skip malformed SSE lines
          }

          const delta = parsed.choices[0];
          yield {
            content: delta?.delta.content ?? '',
            done: delta?.finish_reason === 'stop',
            ...(parsed.model !== undefined && { model: parsed.model }),
          };
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
