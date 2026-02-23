#!/usr/bin/env node
/**
 * holocron benchmark harness
 *
 * Runs 15 ground-truth queries in up to 3 modes:
 *   1. BM25-only  (DARTH_EMBEDDER=noop, always runs)
 *   2. Hybrid     (requires Ollama reachable at localhost:11434, skipped otherwise)
 *   3. Cold-start (deletes DB, re-indexes, restores BM25, then searches)
 *
 * Usage:
 *   npm run benchmark
 *   npm run benchmark -- --no-coldstart   (skip cold-start timing)
 *   npm run benchmark -- --corpus /path/to/repo
 */

import { resolve, join } from 'node:path';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { QUERIES } from './queries.js';
import { recallAtK, mrr as computeMrr, rankOfFirstHit, mean } from './metrics.js';
import { buildReport, printMarkdownTable, writeJsonReport, type QueryResult } from './report.js';
import { createContextEngine } from '../../src/context/index.js';
import { loadConfig } from '../../src/config/loader.js';
import type { ContextEngine } from '../../src/context/contextEngine.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ── CLI arg parsing ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const skipColdstart = args.includes('--no-coldstart');
const corpusIdx = args.indexOf('--corpus');
const corpusDir = corpusIdx !== -1 && args[corpusIdx + 1]
  ? resolve(args[corpusIdx + 1]!)
  : resolve(__dirname, '../../');  // default: the holocron repo itself

const BENCHMARK_DB_DIR = join(corpusDir, '.holocron-benchmark-tmp');
const RESULTS_DIR = __dirname;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function isOllamaReachable(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function buildEngine(persistPath: string, embedder: 'noop' | 'ollama'): Promise<ContextEngine> {
  // Override env for this call
  process.env['DARTH_EMBEDDER'] = embedder;
  process.env['DARTH_PERSIST_PATH'] = persistPath;
  const config = loadConfig();
  return createContextEngine(config.context);
}

async function runQuerySet(
  engine: ContextEngine,
  mode: 'bm25' | 'hybrid' | 'coldstart',
): Promise<QueryResult[]> {
  const results: QueryResult[] = [];

  for (const { q, files } of QUERIES) {
    const t0 = performance.now();
    const searchResults = await engine.search(q, { maxResults: 10 });
    const latencyMs = performance.now() - t0;

    const resultFiles = searchResults.map((r) => r.chunk.filePath);
    const contextCharsInjected = searchResults
      .slice(0, 5)
      .reduce((acc, r) => acc + r.chunk.content.length, 0);

    results.push({
      query: q,
      mode,
      rankOfFirstHit: rankOfFirstHit(resultFiles, files),
      recall5: recallAtK(resultFiles, files, 5),
      recall10: recallAtK(resultFiles, files, 10),
      mrr: computeMrr(resultFiles, files),
      latencyMs,
      contextCharsInjected,
    });

    const hitRank = rankOfFirstHit(resultFiles, files);
    const hitStr = hitRank === Infinity ? '✗ miss' : `✓ rank ${hitRank}`;
    process.stderr.write(
      `  [${mode}] ${hitStr.padEnd(10)} ${(latencyMs.toFixed(1) + 'ms').padEnd(8)} ${q}\n`,
    );
  }

  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  process.stderr.write('\n[benchmark] The Empire begins evaluation of its weapons.\n');
  process.stderr.write(`[benchmark] Corpus: ${corpusDir}\n\n`);

  // Clean up any leftover benchmark DB from a previous run
  if (existsSync(BENCHMARK_DB_DIR)) {
    rmSync(BENCHMARK_DB_DIR, { recursive: true });
  }
  mkdirSync(BENCHMARK_DB_DIR, { recursive: true });

  const bm25DbPath = join(BENCHMARK_DB_DIR, 'bm25.db');
  const hybridDbPath = join(BENCHMARK_DB_DIR, 'hybrid.db');
  const coldDbPath = join(BENCHMARK_DB_DIR, 'cold.db');

  const allResults: QueryResult[] = [];

  // ── Mode 1: BM25-only ────────────────────────────────────────────────────
  process.stderr.write('[benchmark] Mode 1/3: BM25-only (noop embedder)\n');
  {
    const engine = await buildEngine(bm25DbPath, 'noop');
    try {
      process.stderr.write('[benchmark] Indexing corpus...\n');
      const t0 = performance.now();
      await engine.indexDirectory(corpusDir);
      process.stderr.write(`[benchmark] Indexed in ${(performance.now() - t0).toFixed(0)}ms\n`);
      const results = await runQuerySet(engine, 'bm25');
      allResults.push(...results);
    } finally {
      await engine.dispose();
    }
  }

  // ── Mode 2: Hybrid (BM25 + vector) ──────────────────────────────────────
  const ollamaUrl = 'http://localhost:11434';
  const ollamaReachable = await isOllamaReachable(ollamaUrl);
  if (!ollamaReachable) {
    process.stderr.write(
      '[benchmark] Mode 2/3: Hybrid — SKIPPED (Ollama not reachable at localhost:11434)\n',
    );
  } else {
    process.stderr.write('[benchmark] Mode 2/3: Hybrid (BM25 + Ollama vectors)\n');
    const engine = await buildEngine(hybridDbPath, 'ollama');
    try {
      process.stderr.write('[benchmark] Indexing corpus with embeddings...\n');
      const t0 = performance.now();
      await engine.indexDirectory(corpusDir);
      process.stderr.write(`[benchmark] Indexed in ${(performance.now() - t0).toFixed(0)}ms\n`);
      const results = await runQuerySet(engine, 'hybrid');
      allResults.push(...results);
    } catch (err) {
      process.stderr.write(
        `[benchmark] Mode 2/3: Hybrid — SKIPPED (embedding failed: ${String(err)})\n`,
      );
    } finally {
      await engine.dispose();
    }
  }

  // ── Mode 3: Cold-start restore ──────────────────────────────────────────
  if (skipColdstart) {
    process.stderr.write('[benchmark] Mode 3/3: Cold-start — SKIPPED (--no-coldstart)\n');
  } else {
    process.stderr.write('[benchmark] Mode 3/3: Cold-start BM25 restore\n');
    // Step 1: Index with BM25 (to populate SQLite)
    {
      const engine = await buildEngine(coldDbPath, 'noop');
      try {
        await engine.indexDirectory(corpusDir);
      } finally {
        await engine.dispose();
      }
    }
    // Step 2: Simulate cold start — create a NEW engine pointing at the same SQLite DB.
    // FTS5 persists to disk natively; no warmup or restore needed. Search is immediate.
    const t0 = performance.now();
    const engine = await buildEngine(coldDbPath, 'noop');
    try {
      // First search triggers BM25 restore from SQLite
      const results = await runQuerySet(engine, 'coldstart');
      const totalRestoreMs = performance.now() - t0;
      process.stderr.write(
        `[benchmark] Cold-start total time (new engine + restore + ${QUERIES.length} queries): ${totalRestoreMs.toFixed(0)}ms\n`,
      );
      allResults.push(...results);
    } finally {
      await engine.dispose();
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const report = buildReport(allResults, corpusDir);
  printMarkdownTable(report);
  writeJsonReport(report, RESULTS_DIR);

  // Summary stats to stderr
  const bm25 = report.summary.bm25;
  process.stderr.write('\n[benchmark] Summary:\n');
  process.stderr.write(`  BM25  Recall@5=${(bm25.recall5 * 100).toFixed(1)}%  Recall@10=${(bm25.recall10 * 100).toFixed(1)}%  MRR=${bm25.mrr.toFixed(3)}\n`);
  if (report.summary.hybrid) {
    const h = report.summary.hybrid;
    process.stderr.write(`  Hybrid Recall@5=${(h.recall5 * 100).toFixed(1)}%  Recall@10=${(h.recall10 * 100).toFixed(1)}%  MRR=${h.mrr.toFixed(3)}\n`);
  }
  process.stderr.write(`  Token efficiency: ~${report.tokenEfficiency.savingsMultiplier}× savings vs naive full-file reads\n`);

  // Cleanup
  rmSync(BENCHMARK_DB_DIR, { recursive: true, force: true });
  process.stderr.write('\n[benchmark] The Empire is satisfied. Victory is achieved through strength.\n\n');
}

main().catch((err) => {
  process.stderr.write(`[benchmark] FATAL: ${String(err)}\n`);
  process.exit(1);
});
