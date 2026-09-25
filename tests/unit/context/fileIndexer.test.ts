import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted: use require() (vitest-injected, sync) — ES import bindings are
// not yet initialized when vi.hoisted() executes, so we cannot use top-level imports.
const { vol, memfsPromises } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Volume, createFsFromVolume } = require('memfs') as typeof import('memfs');
  const vol = new Volume();
  const memfsPromises = createFsFromVolume(vol).promises;
  return { vol, memfsPromises };
});

vi.mock('node:fs/promises', () => ({
  readdir: (path: string, opts: unknown) => memfsPromises.readdir(path, opts as never),
  realpath: (path: string) => memfsPromises.realpath(path),
  open: (path: string, flags: number) => memfsPromises.open(path, flags),
}));

import { FileIndexer, getLanguage, isWithinRoot } from '../../../src/context/fileIndexer.js';

function setupFs(files: Record<string, string>) {
  vol.reset();
  for (const [path, content] of Object.entries(files)) {
    const dir = path.slice(0, path.lastIndexOf('/'));
    vol.mkdirSync(dir, { recursive: true });
    vol.writeFileSync(path, content);
  }
}

describe('FileIndexer', () => {
  let indexer: FileIndexer;

  beforeEach(() => {
    indexer = new FileIndexer();
  });

  describe('walkDirectory', () => {
    it('yields TypeScript files', async () => {
      setupFs({
        '/repo/src/index.ts': 'export const x = 1;',
        '/repo/src/util.ts': 'export const y = 2;',
      });

      const entries: string[] = [];
      for await (const entry of indexer.walkDirectory('/repo')) {
        entries.push(entry.path);
      }
      expect(entries).toContain('/repo/src/index.ts');
      expect(entries).toContain('/repo/src/util.ts');
    });

    it('skips node_modules', async () => {
      setupFs({
        '/repo/src/main.ts': 'const x = 1;',
        '/repo/node_modules/lib/index.js': 'const lib = {};',
      });

      const entries: string[] = [];
      for await (const entry of indexer.walkDirectory('/repo')) {
        entries.push(entry.path);
      }
      expect(entries).not.toContain('/repo/node_modules/lib/index.js');
      expect(entries).toContain('/repo/src/main.ts');
    });

    it('skips .git directory', async () => {
      setupFs({
        '/repo/src/main.ts': 'const x = 1;',
        '/repo/.git/config': '[core]',
      });

      const entries: string[] = [];
      for await (const entry of indexer.walkDirectory('/repo')) {
        entries.push(entry.path);
      }
      expect(entries.some((p) => p.includes('.git'))).toBe(false);
    });

    it('skips dist directory', async () => {
      setupFs({
        '/repo/src/main.ts': 'const x = 1;',
        '/repo/dist/main.js': 'var x = 1;',
      });

      const entries: string[] = [];
      for await (const entry of indexer.walkDirectory('/repo')) {
        entries.push(entry.path);
      }
      expect(entries).not.toContain('/repo/dist/main.js');
    });

    it('returns correct language for each file', async () => {
      setupFs({
        '/repo/main.ts': 'const x = 1;',
        '/repo/app.py': 'x = 1',
        '/repo/server.go': 'package main',
      });

      const entries: { path: string; language: string }[] = [];
      for await (const entry of indexer.walkDirectory('/repo')) {
        entries.push({ path: entry.path, language: entry.language });
      }

      expect(entries.find((e) => e.path.endsWith('.ts'))?.language).toBe('typescript');
      expect(entries.find((e) => e.path.endsWith('.py'))?.language).toBe('python');
      expect(entries.find((e) => e.path.endsWith('.go'))?.language).toBe('go');
    });

    it('skips unknown extensions', async () => {
      setupFs({
        '/repo/file.xyz': 'unknown format',
        '/repo/main.ts': 'const x = 1;',
      });

      const entries: string[] = [];
      for await (const entry of indexer.walkDirectory('/repo')) {
        entries.push(entry.path);
      }
      expect(entries).not.toContain('/repo/file.xyz');
    });

    it('returns correct file contents', async () => {
      const content = 'export function greet() { return "hello"; }';
      setupFs({ '/repo/greet.ts': content });

      const entries: string[] = [];
      let found: string | null = null;
      for await (const entry of indexer.walkDirectory('/repo')) {
        entries.push(entry.path);
        if (entry.path.endsWith('greet.ts')) found = entry.contents;
      }
      expect(found).toBe(content);
    });
  });

  describe('walkDirectory containment', () => {
    async function walk(root: string): Promise<string[]> {
      const paths: string[] = [];
      for await (const entry of indexer.walkDirectory(root)) paths.push(entry.path);
      return paths;
    }

    it('does not follow a symlinked directory that points outside the root', async () => {
      setupFs({
        '/repo/src/main.ts': 'const x = 1;',
        '/secret/keys.ts': 'export const KEY = "s3cr3t";',
      });
      vol.symlinkSync('/secret', '/repo/src/escape');

      const paths = await walk('/repo');
      expect(paths).toEqual(['/repo/src/main.ts']);
    });

    it('does not follow a symlinked file that points outside the root', async () => {
      setupFs({
        '/repo/main.ts': 'const x = 1;',
        '/secret/keys.ts': 'export const KEY = "s3cr3t";',
      });
      vol.symlinkSync('/secret/keys.ts', '/repo/keys.ts');

      const paths = await walk('/repo');
      expect(paths).toEqual(['/repo/main.ts']);
    });

    it('resolves a symlinked root and yields canonical paths under it', async () => {
      setupFs({ '/real/repo/main.ts': 'const x = 1;' });
      vol.symlinkSync('/real/repo', '/link');

      expect(await walk('/link')).toEqual(['/real/repo/main.ts']);
    });

    it('yields nothing for a missing root', async () => {
      vol.reset();
      expect(await walk('/nope')).toEqual([]);
    });

    it('skips files larger than 1 MB', async () => {
      setupFs({
        '/repo/big.ts': 'x'.repeat(1_048_577),
        '/repo/small.ts': 'const x = 1;',
      });
      expect(await walk('/repo')).toEqual(['/repo/small.ts']);
    });

    it('skips binary files', async () => {
      setupFs({ '/repo/small.ts': 'const x = 1;' });
      vol.writeFileSync('/repo/blob.ts', Buffer.from([0x41, 0x00, 0x42]));
      expect(await walk('/repo')).toEqual(['/repo/small.ts']);
    });
  });

  describe('readFile', () => {
    it('returns FileEntry for a valid text file inside the root', async () => {
      setupFs({ '/repo/hello.ts': 'const x = 1;' });

      const entry = await indexer.readFile('/repo/hello.ts', '/repo');
      expect(entry).not.toBeNull();
      expect(entry?.language).toBe('typescript');
      expect(entry?.contents).toBe('const x = 1;');
    });

    it('returns null for non-existent file', async () => {
      setupFs({ '/repo/hello.ts': 'const x = 1;' });
      const entry = await indexer.readFile('/repo/does-not-exist.ts', '/repo');
      expect(entry).toBeNull();
    });

    it('returns null when the root does not exist', async () => {
      setupFs({ '/repo/hello.ts': 'const x = 1;' });
      expect(await indexer.readFile('/repo/hello.ts', '/missing')).toBeNull();
    });

    it('rejects a ../ traversal out of the root', async () => {
      setupFs({
        '/repo/hello.ts': 'const x = 1;',
        '/etc/passwd.ts': 'root:x:0:0',
      });
      expect(await indexer.readFile('/repo/../etc/passwd.ts', '/repo')).toBeNull();
    });

    it('rejects an absolute path outside the root', async () => {
      setupFs({
        '/repo/hello.ts': 'const x = 1;',
        '/etc/passwd.ts': 'root:x:0:0',
      });
      expect(await indexer.readFile('/etc/passwd.ts', '/repo')).toBeNull();
    });

    it('rejects a sibling directory that shares the root as a string prefix', async () => {
      setupFs({
        '/repo/hello.ts': 'const x = 1;',
        '/repo-other/leak.ts': 'const leak = 1;',
      });
      expect(await indexer.readFile('/repo-other/leak.ts', '/repo')).toBeNull();
    });

    it('rejects a symlink inside the root that points outside it', async () => {
      setupFs({
        '/repo/hello.ts': 'const x = 1;',
        '/secret/keys.ts': 'export const KEY = "s3cr3t";',
      });
      vol.symlinkSync('/secret/keys.ts', '/repo/keys.ts');
      expect(await indexer.readFile('/repo/keys.ts', '/repo')).toBeNull();
    });

    it('rejects a path through a symlinked directory that points outside the root', async () => {
      setupFs({
        '/repo/hello.ts': 'const x = 1;',
        '/secret/keys.ts': 'export const KEY = "s3cr3t";',
      });
      vol.symlinkSync('/secret', '/repo/escape');
      expect(await indexer.readFile('/repo/escape/keys.ts', '/repo')).toBeNull();
    });

    it('allows a symlink whose target stays inside the root', async () => {
      setupFs({ '/repo/src/real.ts': 'const x = 1;' });
      vol.symlinkSync('/repo/src/real.ts', '/repo/alias.ts');
      const entry = await indexer.readFile('/repo/alias.ts', '/repo');
      expect(entry?.contents).toBe('const x = 1;');
    });

    it('returns null for a directory, even with a text extension', async () => {
      setupFs({ '/repo/folder.ts/inner.ts': 'const x = 1;' });
      expect(await indexer.readFile('/repo/folder.ts', '/repo')).toBeNull();
    });

    it('reads a file of exactly 1 MB spanning several read chunks', async () => {
      const content = 'y'.repeat(1_048_576);
      setupFs({ '/repo/edge.ts': content });
      const entry = await indexer.readFile('/repo/edge.ts', '/repo');
      expect(entry?.contents.length).toBe(1_048_576);
      expect(entry?.contents).toBe(content);
    });

    it('returns null for files larger than 1 MB', async () => {
      setupFs({ '/repo/big.ts': 'x'.repeat(1_048_577) });
      expect(await indexer.readFile('/repo/big.ts', '/repo')).toBeNull();
    });
  });

  describe('isWithinRoot', () => {
    it.each([
      ['/repo', '/repo', true],
      ['/repo', '/repo/a.ts', true],
      ['/repo', '/repo/sub/dir/a.ts', true],
      ['/repo', '/repo/..foo.ts', true],
      ['/repo', '/', false],
      ['/repo', '/repo-other/a.ts', false],
      ['/repo', '/etc/passwd', false],
    ])('isWithinRoot(%s, %s) → %s', (root, candidate, expected) => {
      expect(isWithinRoot(root, candidate)).toBe(expected);
    });
  });

  describe('getLanguage', () => {
    it.each([
      ['/src/app.ts', 'typescript'],
      ['/src/App.tsx', 'typescript'],
      ['/src/index.js', 'javascript'],
      ['/src/main.py', 'python'],
      ['/cmd/main.go', 'go'],
      ['/src/lib.rs', 'rust'],
      ['/src/Main.java', 'java'],
      ['/README.md', 'markdown'],
      ['/config.yaml', 'yaml'],
    ])('%s → %s', (path, lang) => {
      expect(getLanguage(path)).toBe(lang);
    });
  });
});
