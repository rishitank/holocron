import type { Chunk } from '../types/context.types.js';

/**
 * Split a camelCase or PascalCase identifier into lowercase space-separated words.
 *
 * Examples:
 *   authenticateUser  → "authenticate user"
 *   HTMLParser        → "html parser"
 *   useOAuth2         → "use o auth 2"
 *   _privateField     → "private field"
 */
export function splitCamelCase(str: string): string {
  return str
    .replace(/^[_]+/, '') // strip leading underscores
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase boundary: "tU" → "t U"
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // acronym boundary: "HTMLParser" → "HTML Parser"
    .replace(/[-_]+/g, ' ') // hyphens/underscores → spaces
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract all camelCase/PascalCase identifiers from source code,
 * split them, deduplicate, and return as a single space-separated token string
 * suitable for FTS5 indexing.
 *
 * Only identifiers with at least one uppercase letter (true mixed-case identifiers)
 * are split; single-case words are already handled by the porter stemmer.
 */
export function extractCodeTokens(content: string): string {
  // Match camelCase identifiers: must contain at least one uppercase letter
  // and start with a letter (skip pure numbers, underscores, etc.)
  const re = /\b([a-zA-Z][a-zA-Z0-9_]*)\b/g;
  const seen = new Set<string>();
  const tokens: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(content)) !== null) {
    const id = m[1] ?? '';
    // Only process identifiers that actually have mixed case
    if (/[A-Z]/.test(id) && /[a-z]/.test(id)) {
      const split = splitCamelCase(id);
      for (const token of split.split(/\s+/)) {
        if (token.length >= 2 && !seen.has(token)) {
          seen.add(token);
          tokens.push(token);
        }
      }
    }
  }

  return tokens.join(' ');
}

/**
 * Normalise a user query before passing to FTS5 MATCH:
 * 1. Split camelCase identifiers so "authenticateUser" becomes "authenticate user"
 * 2. Strip FTS5 special syntax characters that would cause parse errors
 */
export function normalizeQuery(query: string): string {
  // Split each token on camelCase boundaries
  const normalised = query
    .split(/\s+/)
    .map((token) => (/[A-Z]/.test(token) ? splitCamelCase(token) : token.toLowerCase()))
    .join(' ');

  // Remove FTS5 operator characters that can cause MATCH parse failures
  return normalised
    .replace(/[*"():\]^[]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build an enriched content string for embedding only (never stored).
 * Prepends file path, language, and optional symbol name so the embedding
 * vector captures cross-file context.
 *
 * Based on Anthropic contextual retrieval research (2025): prepending
 * document-level context before embedding reduces retrieval failure rate ~67%.
 */
export function buildContextualContent(chunk: Chunk): string {
  const lines: string[] = [
    `File: ${chunk.filePath}`,
    `Language: ${chunk.language}`,
  ];
  if (chunk.symbolName) {
    lines.push(`Symbol: ${chunk.symbolName}`);
  }
  lines.push('', chunk.content);
  return lines.join('\n');
}
