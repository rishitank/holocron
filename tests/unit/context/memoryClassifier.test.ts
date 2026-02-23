import { describe, it, expect } from 'vitest';
import { classifyMemoryType } from '../../../src/context/memoryClassifier.js';

describe('classifyMemoryType', () => {
  // ── Semantic files ──────────────────────────────────────────────────────────

  it('classifies .ts files as semantic', () => {
    expect(classifyMemoryType('src/context/engine.ts')).toBe('semantic');
  });

  it('classifies .py files as semantic', () => {
    expect(classifyMemoryType('scripts/train.py')).toBe('semantic');
  });

  it('classifies .rs files as semantic', () => {
    expect(classifyMemoryType('src/main.rs')).toBe('semantic');
  });

  it('classifies .md files as semantic', () => {
    expect(classifyMemoryType('docs/architecture.md')).toBe('semantic');
  });

  it('classifies test files as semantic', () => {
    expect(classifyMemoryType('tests/unit/engine.test.ts')).toBe('semantic');
    expect(classifyMemoryType('tests/unit/engine.spec.ts')).toBe('semantic');
  });

  it('classifies full source path as semantic', () => {
    expect(classifyMemoryType('src/context/gitTracker.ts')).toBe('semantic');
  });

  // ── Procedural files ────────────────────────────────────────────────────────

  it('classifies .json files as procedural', () => {
    expect(classifyMemoryType('package.json')).toBe('procedural');
  });

  it('classifies .yaml files as procedural', () => {
    expect(classifyMemoryType('config/settings.yaml')).toBe('procedural');
  });

  it('classifies .yml files as procedural', () => {
    expect(classifyMemoryType('.github/workflows/ci.yml')).toBe('procedural');
  });

  it('classifies .sh scripts as procedural', () => {
    expect(classifyMemoryType('scripts/deploy.sh')).toBe('procedural');
  });

  it('classifies Makefile as procedural', () => {
    expect(classifyMemoryType('Makefile')).toBe('procedural');
  });

  it('classifies Dockerfile as procedural', () => {
    expect(classifyMemoryType('Dockerfile')).toBe('procedural');
  });

  it('classifies tsconfig.json as procedural', () => {
    expect(classifyMemoryType('tsconfig.json')).toBe('procedural');
  });

  it('classifies vitest.config.ts as procedural', () => {
    expect(classifyMemoryType('vitest.config.ts')).toBe('procedural');
  });

  it('classifies .eslintrc.json as procedural', () => {
    expect(classifyMemoryType('.eslintrc.json')).toBe('procedural');
  });

  it('classifies docker-compose files as procedural', () => {
    expect(classifyMemoryType('docker-compose.yml')).toBe('procedural');
    expect(classifyMemoryType('docker-compose.override.yml')).toBe('procedural');
  });

  it('classifies .config.ts pattern as procedural', () => {
    expect(classifyMemoryType('tailwind.config.ts')).toBe('procedural');
    expect(classifyMemoryType('next.config.mjs')).toBe('procedural');
  });

  it('classifies jest.config files as procedural', () => {
    expect(classifyMemoryType('jest.config.ts')).toBe('procedural');
  });

  it('classifies .prettierrc files as procedural', () => {
    expect(classifyMemoryType('.prettierrc')).toBe('procedural');
    expect(classifyMemoryType('.prettierrc.json')).toBe('procedural');
  });
});
