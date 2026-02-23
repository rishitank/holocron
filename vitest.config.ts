import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        // Top-level re-exports
        'src/index.ts',
        'src/cli/index.ts',
        // All barrel index files
        'src/**/index.ts',
        // Type-only files (interfaces, no executable code)
        'src/types/**',
        'src/api/schemas.ts',
        'src/backends/inferenceBackend.ts',
        'src/context/contextEngine.ts',
        'src/context/hybridStore.ts',
        // CLI command handlers (require stdin/stdout E2E testing)
        'src/cli/commands/**',
        // Optional peer dependency (not installed in test env by default)
        'src/context/embedders/transformersEmbedder.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
    reporters: ['verbose'],
  },
  resolve: {
    conditions: ['node'],
  },
});
