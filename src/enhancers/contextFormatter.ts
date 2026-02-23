import type { SearchResult } from '../types/context.types.js';

export interface FormatOptions {
  maxCharsPerChunk?: number;
  relevanceThreshold?: number;
  maxResultsPerFile?: number;
}

/**
 * Formats search results into a <codebase_context> XML block for prompt injection.
 * Returns empty string when results is empty — caller should skip injection.
 *
 * Pre-processing pipeline (applied before XML generation):
 * 1. Relevance threshold — filter low-score results
 * 2. Per-file diversity — cap results per unique file path
 * 3. Content deduplication — skip results with duplicate content prefixes
 */
export function formatContext(
  results: SearchResult[],
  query: string,
  options: FormatOptions = {},
): string {
  if (results.length === 0) return '';

  const maxChars = options.maxCharsPerChunk ?? 2000;
  const threshold = options.relevanceThreshold ?? 0.05;
  const maxPerFile = options.maxResultsPerFile ?? 2;

  // (a) Relevance threshold
  const filtered = results.filter(r => r.score >= threshold);

  // (b) Per-file diversity
  const fileCount = new Map<string, number>();
  const diverse = filtered.filter(r => {
    const count = fileCount.get(r.chunk.filePath) ?? 0;
    if (count >= maxPerFile) return false;
    fileCount.set(r.chunk.filePath, count + 1);
    return true;
  });

  // (c) Content deduplication
  const seen = new Set<string>();
  const deduped = diverse.filter(r => {
    const key = r.chunk.content.slice(0, 200);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (deduped.length === 0) return '';

  const resultBlocks = deduped
    .map((r, i) => {
      const { chunk, score } = r;

      // (d) Line-boundary truncation
      let content: string;
      if (chunk.content.length > maxChars) {
        const lastNewline = chunk.content.lastIndexOf('\n', maxChars);
        content =
          (lastNewline > 0
            ? chunk.content.slice(0, lastNewline)
            : chunk.content.slice(0, maxChars)) + '\n... [truncated]';
      } else {
        content = chunk.content;
      }

      // (e) Language attribute + symbol attr
      const symbolAttr = chunk.symbolName ? ` symbol="${chunk.symbolName}"` : '';
      return (
        `<result rank="${i + 1}" file="${chunk.filePath}" lines="${chunk.startLine}-${chunk.endLine}" language="${chunk.language}"${symbolAttr} score="${score.toFixed(2)}">\n` +
        `${content}\n` +
        `</result>`
      );
    })
    .join('\n');

  return (
    `<codebase_context query="${query}" results="${deduped.length}">\n` +
    resultBlocks +
    '\n</codebase_context>'
  );
}
