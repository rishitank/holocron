import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'cli/index': 'src/cli/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  // Preserve node: protocol on built-ins so Node 25 resolves them correctly at runtime
  external: ['node:sqlite', 'node:fs', 'node:fs/promises', 'node:path', 'node:os', 'node:url', 'node:module', 'node:crypto', 'node:stream', 'node:util', 'node:process'],
  esbuildOptions(options) {
    options.platform = 'node';
    options.packages = 'external'; // All node_modules resolved at runtime; not bundled
  },
  async onSuccess() {
    // esbuild strips the `node:` prefix from import('node:sqlite') → import('sqlite').
    // `sqlite` without the prefix is NOT a valid Node.js built-in — only `node:sqlite` works.
    // Restore the prefix with a post-build string replacement.
    const { readFile, writeFile } = await import('node:fs/promises');
    const outputs = ['dist/index.js', 'dist/cli/index.js'];
    for (const f of outputs) {
      let src: string;
      try {
        src = await readFile(f, 'utf8');
      } catch {
        continue; // file may not exist in this build invocation
      }
      const patched = src.replaceAll("import('sqlite')", "import('node:sqlite')");
      if (patched !== src) {
        await writeFile(f, patched);
      }
    }
  },
});
