import { basename } from 'node:path';

export type MemoryType = 'semantic' | 'procedural';

/**
 * Extensions that mark a file as procedural (config, tooling, build).
 * Checked case-insensitively against the file's basename.
 */
const PROCEDURAL_EXTENSIONS = new Set([
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.env',
  '.sh',
  '.bash',
  '.zsh',
]);

/**
 * Exact basenames (case-insensitive) that are procedural.
 */
const PROCEDURAL_NAMES = new Set(['makefile', 'dockerfile']);

/**
 * Regex patterns matched against the basename (case-insensitive).
 * Any match classifies the file as procedural.
 */
const PROCEDURAL_PATTERNS: RegExp[] = [
  /^docker-compose/i,
  /\.config\.(ts|js|cjs|mjs)$/i,
  /^tsconfig.*\.json$/i,
  /^\.eslintrc/i,
  /^\.prettierrc/i,
  /^vitest\.config/i,
  /^jest\.config/i,
];

/**
 * Classify a file's memory type based on its path.
 *
 * Procedural files (config, tooling, build): less likely to contain the
 * implementation detail the user is searching for -- weighted down in retrieval.
 *
 * Semantic files (source code, docs, tests): primary retrieval targets.
 */
export function classifyMemoryType(filePath: string): MemoryType {
  const name = basename(filePath);
  const nameLower = name.toLowerCase();

  // Check exact names
  if (PROCEDURAL_NAMES.has(nameLower)) {
    return 'procedural';
  }

  // Check extension
  const dotIndex = nameLower.lastIndexOf('.');
  if (dotIndex !== -1) {
    const ext = nameLower.slice(dotIndex);
    if (PROCEDURAL_EXTENSIONS.has(ext)) {
      return 'procedural';
    }
  }

  // Check regex patterns
  for (const pattern of PROCEDURAL_PATTERNS) {
    if (pattern.test(name)) {
      return 'procedural';
    }
  }

  return 'semantic';
}
