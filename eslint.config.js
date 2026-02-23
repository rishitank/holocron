import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // Numbers in template literals is idiomatic TypeScript — too strict to forbid
      '@typescript-eslint/restrict-template-expressions': 'off',
      // Deprecation warnings are useful but shouldn't block CI
      '@typescript-eslint/no-deprecated': 'warn',
      // Overly conservative in non-trivial control flow
      '@typescript-eslint/no-unnecessary-condition': 'warn',
    },
  },
  {
    // Test files are excluded from tsconfig.json (rootDir: src).
    // Disable type-aware rules for tests — syntax/style rules still apply.
    files: ['tests/**/*.ts'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      // Merge disableTypeChecked rules (spread so our overrides take precedence)
      ...tseslint.configs.disableTypeChecked.rules,
      // Non-null assertions are idiomatic in test assertions
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Empty mock functions are valid test stubs
      '@typescript-eslint/no-empty-function': 'off',
      // Test files may use import() types freely
      '@typescript-eslint/consistent-type-imports': 'off',
      // Unused vars in test scaffolding are acceptable
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.config.ts', '*.config.js'],
  },
);
