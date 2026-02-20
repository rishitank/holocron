import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

export interface FileEntry {
  path: string;
  contents: string;
  language: string;
}

const MAX_FILE_SIZE = 1_048_576; // 1 MB

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  'target', // Rust/Java build output
  'vendor',
]);

const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.rb': 'ruby',
  '.cs': 'csharp',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.hpp': 'cpp',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.lua': 'lua',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.fish': 'bash',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.json': 'json',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.toml': 'toml',
  '.xml': 'xml',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.php': 'php',
};

const TEXT_EXTENSIONS = new Set(Object.keys(EXT_TO_LANGUAGE));

export function getLanguage(filePath: string): string {
  return EXT_TO_LANGUAGE[extname(filePath).toLowerCase()] ?? 'text';
}

/**
 * Detects if a buffer is likely binary by sampling bytes.
 * Returns true if >5% of sampled bytes are non-printable non-whitespace.
 */
function isBinary(buf: Buffer): boolean {
  const sampleSize = Math.min(buf.length, 8000);
  let nonPrintable = 0;
  for (let i = 0; i < sampleSize; i++) {
    const b = buf[i];
    if (b === undefined) continue;
    // Null byte is a strong binary indicator
    if (b === 0) return true;
    if (b < 9 || (b > 13 && b < 32 && b !== 27)) nonPrintable++;
  }
  return nonPrintable / sampleSize > 0.05;
}

export class FileIndexer {
  /**
   * Walk a directory recursively, yielding text file entries.
   * Skips: binary files, files > 1 MB, known noise directories.
   */
  async *walkDirectory(dirPath: string): AsyncGenerator<FileEntry> {
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return; // permission error or not a directory
    }

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          yield* this.walkDirectory(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) continue;

      try {
        const info = await stat(fullPath);
        if (info.size > MAX_FILE_SIZE) continue;

        const raw = await readFile(fullPath);
        if (isBinary(raw)) continue;

        yield {
          path: fullPath,
          contents: raw.toString('utf8'),
          language: EXT_TO_LANGUAGE[ext] ?? 'text',
        };
      } catch {
        // Skip unreadable files
      }
    }
  }

  /**
   * Read a single file, returning null on error or when the file
   * is too large / binary.
   */
  async readFile(filePath: string): Promise<FileEntry | null> {
    try {
      const info = await stat(filePath);
      if (info.size > MAX_FILE_SIZE) return null;

      const raw = await readFile(filePath);
      if (isBinary(raw)) return null;

      return {
        path: filePath,
        contents: raw.toString('utf8'),
        language: getLanguage(filePath),
      };
    } catch {
      return null;
    }
  }
}
