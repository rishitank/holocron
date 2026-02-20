import type { SearchResult } from '../types/context.types.js';

export interface FormatOptions {
  maxCharsPerChunk?: number;
}

/**
 * Formats search results into a <codebase_context> XML block for prompt injection.
 * Returns empty string when results is empty — caller should skip injection.
 */
export function formatContext(
  results: SearchResult[],
  query: string,
  options: FormatOptions = {},
): string {
  if (results.length === 0) return '';

  const maxChars = options.maxCharsPerChunk ?? 2000;

  const resultBlocks = results
    .map((r, i) => {
      const { chunk, score } = r;
      const content =
        chunk.content.length > maxChars
          ? chunk.content.slice(0, maxChars) + '\n... [truncated]'
          : chunk.content;

      const symbolAttr = chunk.symbolName ? ` symbol="${chunk.symbolName}"` : '';
      return (
        `<result rank="${i + 1}" file="${chunk.filePath}" lines="${chunk.startLine}-${chunk.endLine}"${symbolAttr} score="${score.toFixed(2)}">\n` +
        `${content}\n` +
        `</result>`
      );
    })
    .join('\n');

  return (
    `<codebase_context query="${query}" results="${results.length}">\n` +
    resultBlocks +
    '\n</codebase_context>'
  );
}
