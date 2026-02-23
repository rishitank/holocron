import type { AppConfig, BackendConfig } from '../types/config.types.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function deepMerge<T>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as Array<keyof T>) {
    const val = override[key];
    if (val !== undefined && val !== null) {
      if (
        typeof val === 'object' &&
        !Array.isArray(val) &&
        typeof base[key] === 'object' &&
        base[key] !== null
      ) {
        result[key] = deepMerge(base[key] as object, val as object) as T[keyof T];
      } else {
        result[key] = val as T[keyof T];
      }
    }
  }
  return result;
}

function loadFileConfig(cwd: string): Partial<AppConfig> {
  const candidates = [
    join(cwd, '.holocron.json'),
    join(cwd, 'holocron.config.json'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, 'utf-8');
        return JSON.parse(raw) as Partial<AppConfig>;
      } catch {
        // ignore parse errors
      }
    }
  }
  return {};
}

function loadEnvOverrides(): Partial<AppConfig> {
  const overrides: Partial<AppConfig> = {};

  const port = process.env['DARTH_PROXY_PORT'];
  const host = process.env['DARTH_PROXY_HOST'];
  if (port ?? host) {
    overrides.api = {
      port: port !== undefined ? parseInt(port, 10) : DEFAULT_CONFIG.api.port,
      host: host ?? DEFAULT_CONFIG.api.host,
    };
  }

  const logLevel = process.env['DARTH_LOG_LEVEL'];
  if (logLevel) {
    overrides.logLevel = logLevel as AppConfig['logLevel'];
  }

  // Backend overrides from env
  const anthropicKey = process.env['ANTHROPIC_API_KEY'];
  const anthropicBaseUrl = process.env['ANTHROPIC_BASE_URL'];
  const ollamaBaseUrl = process.env['OLLAMA_BASE_URL'];

  if (anthropicKey) {
    const backendOverride: BackendConfig = {
      type: 'anthropic',
      apiKey: anthropicKey,
      model: process.env['ANTHROPIC_MODEL'] ?? 'claude-3-5-sonnet-20241022',
      ...(anthropicBaseUrl ? { baseUrl: anthropicBaseUrl } : {}),
    };
    overrides.backend = backendOverride;
  } else if (ollamaBaseUrl) {
    overrides.backend = {
      type: 'ollama',
      baseUrl: ollamaBaseUrl,
      model: process.env['OLLAMA_MODEL'] ?? DEFAULT_CONFIG.backend.model,
    };
  }

  // Context overrides
  const persistPath = process.env['DARTH_PERSIST_PATH'];
  const embedder = process.env['DARTH_EMBEDDER'];
  if (persistPath ?? embedder) {
    overrides.context = {
      ...DEFAULT_CONFIG.context,
      ...(persistPath ? { persistPath } : {}),
      ...(embedder ? { embedder: embedder as AppConfig['context']['embedder'] } : {}),
    };
  }

  return overrides;
}

export function loadConfig(cwd: string = process.cwd()): AppConfig {
  const fileConfig = loadFileConfig(cwd);
  const envOverrides = loadEnvOverrides();

  let config = deepMerge(DEFAULT_CONFIG, fileConfig);
  config = deepMerge(config, envOverrides);

  return config;
}
