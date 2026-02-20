import type { Chunk } from '../types/context.types.js';

export interface Chunker {
  chunk(file: { path: string; contents: string; language: string }): Chunk[];
}

// Regex patterns for identifying function/class/method boundaries per language
interface LangPattern {
  pattern: RegExp;
  nameGroup: number;
  symbolType: string;
}

const LANGUAGE_PATTERNS: Record<string, LangPattern[]> = {
  typescript: [
    { pattern: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m, nameGroup: 1, symbolType: 'function' },
    { pattern: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/m, nameGroup: 1, symbolType: 'class' },
    { pattern: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/m, nameGroup: 1, symbolType: 'function' },
    { pattern: /^\s+(?:async\s+)?(\w+)\s*\(/m, nameGroup: 1, symbolType: 'method' },
  ],
  javascript: [
    { pattern: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m, nameGroup: 1, symbolType: 'function' },
    { pattern: /^(?:export\s+)?class\s+(\w+)/m, nameGroup: 1, symbolType: 'class' },
    { pattern: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/m, nameGroup: 1, symbolType: 'function' },
  ],
  python: [
    { pattern: /^(?:async\s+)?def\s+(\w+)\s*\(/m, nameGroup: 1, symbolType: 'function' },
    { pattern: /^class\s+(\w+)/m, nameGroup: 1, symbolType: 'class' },
  ],
  go: [
    { pattern: /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/m, nameGroup: 1, symbolType: 'function' },
    { pattern: /^type\s+(\w+)\s+struct/m, nameGroup: 1, symbolType: 'struct' },
  ],
  rust: [
    { pattern: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/m, nameGroup: 1, symbolType: 'function' },
    { pattern: /^(?:pub\s+)?struct\s+(\w+)/m, nameGroup: 1, symbolType: 'struct' },
    { pattern: /^(?:pub\s+)?impl(?:\s+\w+\s+for)?\s+(\w+)/m, nameGroup: 1, symbolType: 'impl' },
  ],
  java: [
    { pattern: /^(?:public|private|protected|static|\s)+(?:\w+\s+)+(\w+)\s*\(/m, nameGroup: 1, symbolType: 'method' },
    { pattern: /^(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/m, nameGroup: 1, symbolType: 'class' },
  ],
  ruby: [
    { pattern: /^(?:\s+)?def\s+(\w+)/m, nameGroup: 1, symbolType: 'method' },
    { pattern: /^class\s+(\w+)/m, nameGroup: 1, symbolType: 'class' },
  ],
  csharp: [
    { pattern: /^(?:public|private|protected|static|\s)+(?:\w+\s+)+(\w+)\s*\(/m, nameGroup: 1, symbolType: 'method' },
    { pattern: /^(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/m, nameGroup: 1, symbolType: 'class' },
  ],
};

const SUPPORTED_LANGUAGES = new Set(Object.keys(LANGUAGE_PATTERNS));

// Lines-per-chunk limit before we split large blocks
const MAX_LINES_PER_CHUNK = 150;
const OVERLAP_LINES = 10;

export function getChunker(language: string): Chunker {
  if (SUPPORTED_LANGUAGES.has(language)) {
    return new TreeChunker();
  }
  return new TextChunker();
}

export class TreeChunker implements Chunker {
  chunk(file: { path: string; contents: string; language: string }): Chunk[] {
    const { path, contents, language } = file;
    const patterns = LANGUAGE_PATTERNS[language];
    if (!patterns) {
      // Unsupported language — fall back to text chunking
      return new TextChunker().chunk(file);
    }

    const lines = contents.split('\n');
    const chunks: Chunk[] = [];

    // Find block boundaries by scanning for top-level declarations
    const boundaries = this.findBoundaries(lines, patterns);

    if (boundaries.length === 0) {
      // No boundaries found — return the whole file as one chunk
      return this.splitIfLarge([{
        id: `${path}:0:${lines.length}`,
        content: contents,
        filePath: path,
        startLine: 0,
        endLine: lines.length,
        language,
      }], path, language);
    }

    for (let i = 0; i < boundaries.length; i++) {
      const start = boundaries[i]!.line;
      const end = i + 1 < boundaries.length ? boundaries[i + 1]!.line : lines.length;
      const content = lines.slice(start, end).join('\n');

      const boundaryName = boundaries[i]!.name;
      const chunk: Chunk = {
        id: `${path}:${start}:${end}`,
        content,
        filePath: path,
        startLine: start,
        endLine: end,
        language,
        ...(boundaryName !== undefined && { symbolName: boundaryName }),
      };

      chunks.push(...this.splitIfLarge([chunk], path, language));
    }

    return chunks;
  }

  private findBoundaries(
    lines: string[],
    patterns: LangPattern[],
  ): Array<{ line: number; name?: string }> {
    const boundaries: Array<{ line: number; name?: string }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      for (const { pattern, nameGroup } of patterns) {
        const match = line.match(pattern);
        if (match) {
          const name = match[nameGroup];
          if (
            !name?.startsWith('_') &&
            !['if', 'for', 'while', 'return', 'const', 'let', 'var'].includes(name ?? '')
          ) {
            boundaries.push({ line: i, ...(name !== undefined && { name }) });
            break;
          }
        }
      }
    }

    return boundaries;
  }

  private splitIfLarge(chunks: Chunk[], path: string, language: string): Chunk[] {
    const result: Chunk[] = [];

    for (const chunk of chunks) {
      const chunkLines = chunk.content.split('\n');
      if (chunkLines.length <= MAX_LINES_PER_CHUNK) {
        result.push(chunk);
        continue;
      }

      // Split into overlapping sub-chunks
      let offset = 0;
      let subIdx = 0;
      while (offset < chunkLines.length) {
        const end = Math.min(offset + MAX_LINES_PER_CHUNK, chunkLines.length);
        const subContent = chunkLines.slice(offset, end).join('\n');
        const absStart = chunk.startLine + offset;
        const absEnd = chunk.startLine + end;

        result.push({
          id: `${path}:${absStart}:${absEnd}:${subIdx}`,
          content: subContent,
          filePath: path,
          startLine: absStart,
          endLine: absEnd,
          language,
          ...(chunk.symbolName !== undefined && { symbolName: `${chunk.symbolName}[${subIdx}]` }),
        });

        offset += MAX_LINES_PER_CHUNK - OVERLAP_LINES;
        subIdx++;
        if (end >= chunkLines.length) break;
      }
    }

    return result;
  }
}

export class TextChunker implements Chunker {
  constructor(
    private readonly chunkSize = 200,
    private readonly overlap = 20,
  ) {}

  chunk(file: { path: string; contents: string; language: string }): Chunk[] {
    const { path, contents, language } = file;
    const lines = contents.split('\n');
    const chunks: Chunk[] = [];

    let offset = 0;
    let idx = 0;

    while (offset < lines.length) {
      const end = Math.min(offset + this.chunkSize, lines.length);
      const content = lines.slice(offset, end).join('\n');

      chunks.push({
        id: `${path}:${offset}:${end}:${idx}`,
        content,
        filePath: path,
        startLine: offset,
        endLine: end,
        language,
      });

      offset += this.chunkSize - this.overlap;
      idx++;
      if (end >= lines.length) break;
    }

    return chunks;
  }
}
