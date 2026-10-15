import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { FileIndexer } from '../../src/context/fileIndexer.js';

// Real-filesystem checks for FileIndexer's post-open containment check. The
// unit suite simulates the races on memfs; this suite makes sure the check
// accepts ordinary files on the real platform. On Linux that means the path
// the kernel reports for the open descriptor (/proc/self/fd/<fd>) must match
// the realpath-based root.
describe.skipIf(process.platform === 'win32')('FileIndexer containment on a real filesystem', () => {
  let base: string;
  let root: string;
  const indexer = new FileIndexer();

  beforeEach(async () => {
    // realpath: tmpdir() is itself a symlink on some platforms (macOS /var).
    base = await realpath(await mkdtemp(join(tmpdir(), 'holocron-fi-')));
    root = join(base, 'repo');
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(base, 'secret'));
    await writeFile(join(root, 'src', 'a.ts'), 'const a = 1;');
    await writeFile(join(base, 'secret', 'keys.ts'), 'export const KEY = "s3cr3t";');
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('reads a regular file inside the root', async () => {
    const entry = await indexer.readFileWithinCanonicalRoot(join(root, 'src', 'a.ts'), root);
    expect(entry?.path).toBe(join(root, 'src', 'a.ts'));
    expect(entry?.contents).toBe('const a = 1;');
  });

  it('walks the root and yields its files', async () => {
    const paths: string[] = [];
    for await (const entry of indexer.walkDirectory(root)) paths.push(entry.path);
    expect(paths).toEqual([join(root, 'src', 'a.ts')]);
  });

  it('rejects a path through a symlinked directory that points outside the root', async () => {
    await symlink(join(base, 'secret'), join(root, 'escape'));
    expect(await indexer.readFileWithinCanonicalRoot(join(root, 'escape', 'keys.ts'), root)).toBeNull();
  });

  it('rejects everything once the root itself is replaced by a symlink', async () => {
    await rm(root, { recursive: true });
    await symlink(join(base, 'secret'), root);
    expect(await indexer.readFileWithinCanonicalRoot(join(root, 'keys.ts'), root)).toBeNull();
  });
});
