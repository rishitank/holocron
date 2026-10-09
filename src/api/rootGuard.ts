import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { isWithinRoot } from '../context/fileIndexer.js';

/**
 * Canonicalise the roots the REST API may index (make each absolute and
 * resolve its symlinks). Roots that do not exist are dropped.
 */
export async function canonicalRoots(roots: readonly string[]): Promise<string[]> {
  const canonical: string[] = [];
  for (const root of roots) {
    try {
      canonical.push(await realpath(resolve(root)));
    } catch {
      // A missing root allows nothing.
    }
  }
  return canonical;
}

/**
 * Map a directory named in a REST request to the canonical directory to
 * index, or null when it is not inside one of `allowedRoots` (canonical, from
 * canonicalRoots()).
 *
 * POST /index takes its directory from the network, so it must not be able to
 * name an arbitrary path on disk. Two checks, in this order:
 * 1. Lexical, before touching the filesystem: the resolved path must sit at
 *    or under an allowed root. `..` segments and absolute paths elsewhere fail
 *    here. The check is written inline (path.relative, then a `..` prefix
 *    test) rather than through isWithinRoot() so that static analysis
 *    (CodeQL js/path-injection) recognises it as the sanitiser.
 * 2. After realpath(): the real location must still be inside an allowed
 *    root, so a symlink under a root that points outside it is rejected too.
 *
 * Returns null as well when the directory does not exist.
 */
export async function resolveAllowedDirectory(
  directory: string,
  allowedRoots: readonly string[],
): Promise<string | null> {
  const requested = resolve(directory);
  for (const root of allowedRoots) {
    const rel = relative(root, requested);
    if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) continue;

    let real: string;
    try {
      real = await realpath(requested);
    } catch {
      return null;
    }
    return allowedRoots.some((allowed) => isWithinRoot(allowed, real)) ? real : null;
  }
  return null;
}
