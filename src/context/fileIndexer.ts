import { constants, type Stats } from 'node:fs';
import { open, readdir, readlink, realpath, stat, type FileHandle } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

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

/**
 * Flags for opening a file we are about to index.
 * - O_NOFOLLOW: if the final path component was swapped for a symlink after we
 *   checked it, open() fails (ELOOP) instead of following the link.
 * - O_NONBLOCK: if it was swapped for a FIFO, open() returns at once instead of
 *   hanging; the fstat() check below then rejects it as "not a regular file".
 * @types/node types both as always present, but they are undefined on Windows,
 * where they fall back to 0.
 */
const optionalFlags = constants as Partial<Record<'O_NOFOLLOW' | 'O_NONBLOCK', number>>;
const OPEN_FLAGS =
  constants.O_RDONLY | (optionalFlags.O_NOFOLLOW ?? 0) | (optionalFlags.O_NONBLOCK ?? 0);

const READ_CHUNK = 64 * 1024;

/**
 * Read an open file to EOF, but give up (null) as soon as more than `limit`
 * bytes arrive. fstat's size can be stale if the file grows after we checked
 * it, so the cap is enforced on the bytes actually read.
 */
async function readAtMost(handle: FileHandle, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const chunk = Buffer.alloc(Math.min(READ_CHUNK, limit + 1 - total));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > limit) return null;
    chunks.push(chunk.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, total);
}

/**
 * The path the kernel reports for an open descriptor, or null when the
 * platform cannot say. On Linux, /proc/self/fd/<fd> is resolved from the
 * descriptor itself, so it names the file actually opened and cannot be raced.
 */
async function descriptorPath(handle: FileHandle): Promise<string | null> {
  if (process.platform !== 'linux') return null;
  try {
    return await readlink(`/proc/self/fd/${handle.fd}`);
  } catch {
    return null;
  }
}

/**
 * Post-open containment check for `handle`, opened from the canonical path
 * `expected` after `expected` was checked to be inside `root`.
 *
 * Node has no openat()/openat2(RESOLVE_BENEATH), so a descriptor-relative walk
 * from the root is not possible, and O_NOFOLLOW only covers the last path
 * component. If an intermediate directory is swapped for a symlink between the
 * realpath() check and open(), open() follows it. So verify the file that was
 * actually opened, not the path that was asked for:
 * - where the kernel reports the descriptor's path (Linux), it must be inside
 *   `root`;
 * - elsewhere, `expected` must still be canonical and still name the same
 *   inode (dev + ino) as the open handle. A swap that is undone before this
 *   check leaves a different inode behind, and one that is not undone makes
 *   `expected` non-canonical.
 */
async function openedWithinRoot(
  handle: FileHandle,
  info: Stats,
  expected: string,
  root: string,
): Promise<boolean> {
  const actual = await descriptorPath(handle);
  if (actual !== null) return isWithinRoot(root, actual);
  try {
    if ((await realpath(expected)) !== expected) return false;
    const current = await stat(expected);
    return current.dev === info.dev && current.ino === info.ino;
  } catch {
    return false;
  }
}

/**
 * True when `candidate` is `root` itself or lies underneath it.
 * Both arguments must already be absolute and normalised (e.g. from realpath).
 * Uses path.relative rather than a string prefix test so that `/repo-other`
 * is not treated as inside `/repo`.
 */
export function isWithinRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  if (rel === '') return true;
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export class FileIndexer {
  /**
   * Canonicalise a directory the user chose to index: make it absolute and
   * resolve every symlink in it. Every file read afterwards must stay under
   * this path. Throws if the path does not exist.
   */
  async resolveRoot(dirPath: string): Promise<string> {
    return realpath(resolve(dirPath));
  }

  /**
   * Canonical form of a file path, matching the keys indexing stores.
   * Resolves symlinks in the longest prefix that still exists and appends
   * the rest, so a file (or directory) deleted since it was indexed still
   * maps to the path it was stored under, even when reached through a
   * symlinked alias of the root.
   */
  async canonicalPath(filePath: string): Promise<string> {
    const abs = resolve(filePath);
    const missing: string[] = [];
    let existing = abs;
    for (;;) {
      try {
        return join(await realpath(existing), ...missing);
      } catch {
        const parent = dirname(existing);
        if (parent === existing) return abs;
        missing.unshift(basename(existing));
        existing = parent;
      }
    }
  }

  /**
   * Walk a directory recursively, yielding text file entries.
   * Skips: binary files, files > 1 MB, known noise directories, and symlinks
   * (readdir's Dirent types come from lstat, so a symlink is neither a file
   * nor a directory here and is never followed).
   *
   * Yielded paths are under the canonical (realpath) root.
   */
  async *walkDirectory(dirPath: string): AsyncGenerator<FileEntry> {
    let root: string;
    try {
      root = await this.resolveRoot(dirPath);
    } catch {
      return; // missing or unreadable root
    }
    yield* this.walk(root, root);
  }

  /**
   * Read a single file, returning null on error, when the file is too large
   * or binary, or when it resolves (through `..` or any symlink) to a location
   * outside `rootDir`. The returned `path` is the file's canonical (realpath)
   * location, so aliases of one file map to one stored key.
   */
  async readFile(filePath: string, rootDir: string): Promise<FileEntry | null> {
    let root: string;
    try {
      root = await this.resolveRoot(rootDir);
    } catch {
      return null;
    }
    return this.readFileWithinCanonicalRoot(filePath, root);
  }

  /**
   * Like readFile(), but for a root the caller has already canonicalised
   * (with resolveRoot) and authorised. The root is used as given and not
   * resolved again, so replacing the indexed directory with a symlink later
   * cannot move the boundary: files then resolve outside `canonicalRoot` and
   * are rejected.
   */
  async readFileWithinCanonicalRoot(
    filePath: string,
    canonicalRoot: string,
  ): Promise<FileEntry | null> {
    return this.readContained(resolve(filePath), canonicalRoot);
  }

  private async *walk(dir: string, root: string): AsyncGenerator<FileEntry> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // permission error or not a directory
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (!isWithinRoot(root, fullPath)) continue;

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          yield* this.walk(fullPath, root);
        }
        continue;
      }

      if (!entry.isFile()) continue;
      if (!TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;

      const file = await this.readContained(fullPath, root);
      if (file) yield file;
    }
  }

  /**
   * Read `filePath` only if its real location is inside `root` (already
   * canonical). The entry's `path` is that real location.
   *
   * The file is opened first and then inspected through the open handle
   * (fstat), not stat-then-open, so the size and type we check are those of
   * the file we actually read. Before anything is read, openedWithinRoot()
   * confirms the opened file is still inside `root`, which catches a directory
   * swapped for a symlink between the realpath() check and open().
   */
  private async readContained(filePath: string, root: string): Promise<FileEntry | null> {
    let realFile: string;
    try {
      realFile = await realpath(filePath);
    } catch {
      return null;
    }
    if (!isWithinRoot(root, realFile)) return null;

    let handle: FileHandle | undefined;
    try {
      handle = await open(realFile, OPEN_FLAGS);
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_FILE_SIZE) return null;
      if (!(await openedWithinRoot(handle, info, realFile, root))) return null;

      const raw = await readAtMost(handle, MAX_FILE_SIZE);
      if (raw === null || isBinary(raw)) return null;

      return {
        path: realFile,
        contents: raw.toString('utf8'),
        language: getLanguage(realFile),
      };
    } catch {
      return null; // unreadable, vanished, or swapped for a symlink (ELOOP)
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}
