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
  readFile: (path: string) => memfsPromises.readFile(path),
  stat: (path: string) => memfsPromises.stat(path),
}));

import { FileIndexer, getLanguage } from '../../../src/context/fileIndexer.js';

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

  describe('readFile', () => {
    it('returns FileEntry for a valid text file', async () => {
      setupFs({ '/repo/hello.ts': 'const x = 1;' });

      const entry = await indexer.readFile('/repo/hello.ts');
      expect(entry).not.toBeNull();
      expect(entry?.language).toBe('typescript');
      expect(entry?.contents).toBe('const x = 1;');
    });

    it('returns null for non-existent file', async () => {
      vol.reset();
      const entry = await indexer.readFile('/does/not/exist.ts');
      expect(entry).toBeNull();
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
