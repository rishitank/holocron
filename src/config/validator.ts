import type { AppConfig, BackendConfig } from '../types/config.types.js';

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function validateBackend(backend: BackendConfig): void {
  if (backend.type === 'anthropic') {
    if (!backend.apiKey || backend.apiKey.trim() === '') {
      throw new ConfigValidationError(
        'Backend type "anthropic" requires apiKey. Set ANTHROPIC_API_KEY env var or provide in config.',
      );
    }
  }
  if (backend.type === 'openai-compatible') {
    if (!backend.baseUrl || backend.baseUrl.trim() === '') {
      throw new ConfigValidationError(
        'Backend type "openai-compatible" requires baseUrl.',
      );
    }
  }
  if (backend.type === 'ollama') {
    if (!backend.baseUrl || backend.baseUrl.trim() === '') {
      throw new ConfigValidationError('Backend type "ollama" requires baseUrl.');
    }
  }
}

export function validateConfig(config: AppConfig): void {
  validateBackend(config.backend);

  if (config.context.mode === 'augment' && !process.env['AUGMENT_API_TOKEN']) {
    throw new ConfigValidationError(
      'Context mode "augment" requires AUGMENT_API_TOKEN env var.',
    );
  }

  if (config.api.port < 1 || config.api.port > 65535) {
    throw new ConfigValidationError(
      `API port must be between 1 and 65535, got ${config.api.port}.`,
    );
  }

  if (config.enhancer.maxContextResults < 1) {
    throw new ConfigValidationError('enhancer.maxContextResults must be >= 1.');
  }
}
