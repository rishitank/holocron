import type { AnthropicConfig } from '../types/config.types.js';
import type { InferenceRequest, InferenceResponse, InferenceChunk } from '../types/inference.types.js';
import type { InferenceBackend } from './inferenceBackend.js';
import { BackendError } from '../errors/backend.js';

export class AnthropicBackend implements InferenceBackend {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly temperature: number | undefined;
  private readonly maxTokens: number;

  constructor(config: AnthropicConfig) {
    const envBaseUrl = process.env['ANTHROPIC_BASE_URL'];
    this.baseUrl = (envBaseUrl ?? config.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.temperature = config.temperature;
    this.maxTokens = config.maxTokens ?? 4096;
  }

  async complete(request: InferenceRequest): Promise<InferenceResponse> {
    const url = `${this.baseUrl}/v1/messages`;

    const systemMessage = request.messages.find(m => m.role === 'system');
    const nonSystemMessages = request.messages.filter(m => m.role !== 'system');

    const body: Record<string, unknown> = {
      model: request.model ?? this.model,
      max_tokens: request.maxTokens ?? this.maxTokens,
      messages: nonSystemMessages.map(m => ({
        role: m.role,
        content: [{ type: 'text', text: m.content }],
      })),
    };

    if (systemMessage) {
      body['system'] = systemMessage.content;
    }

    if (request.temperature !== undefined || this.temperature !== undefined) {
      body['temperature'] = request.temperature ?? this.temperature;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new BackendError(
        `Anthropic request failed: ${res.status} ${res.statusText}`,
        res.status,
      );
    }

    const data = (await res.json()) as {
      content: { type: string; text: string }[];
      model: string;
      usage?: { input_tokens?: number; output_tokens?: number };
      stop_reason?: string;
    };

    const text = data.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    return {
      content: text,
      model: data.model,
      ...(data.usage?.input_tokens !== undefined && { inputTokens: data.usage.input_tokens }),
      ...(data.usage?.output_tokens !== undefined && { outputTokens: data.usage.output_tokens }),
      ...(data.stop_reason !== undefined && { finishReason: data.stop_reason }),
    };
  }

  async *stream(request: InferenceRequest): AsyncIterable<InferenceChunk> {
    const url = `${this.baseUrl}/v1/messages`;

    const systemMessage = request.messages.find(m => m.role === 'system');
    const nonSystemMessages = request.messages.filter(m => m.role !== 'system');

    const body: Record<string, unknown> = {
      model: request.model ?? this.model,
      max_tokens: request.maxTokens ?? this.maxTokens,
      stream: true,
      messages: nonSystemMessages.map(m => ({
        role: m.role,
        content: [{ type: 'text', text: m.content }],
      })),
    };

    if (systemMessage) {
      body['system'] = systemMessage.content;
    }

    if (request.temperature !== undefined || this.temperature !== undefined) {
      body['temperature'] = request.temperature ?? this.temperature;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new BackendError(
        `Anthropic stream failed: ${res.status} ${res.statusText}`,
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
            type: string;
            delta?: { type?: string; text?: string };
            message?: { model?: string };
          };
          try {
            parsed = JSON.parse(payload) as typeof parsed;
          } catch {
            continue; // skip malformed SSE lines
          }

          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            yield {
              content: parsed.delta.text ?? '',
              done: false,
              model: this.model,
            };
          } else if (parsed.type === 'message_stop') {
            yield { content: '', done: true, model: this.model };
            return;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(this.baseUrl, { method: 'GET' });
      return res.ok || res.status === 401 || res.status === 403;
    } catch {
      return false;
    }
  }
}
