import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mean, pct } from './metrics.js';

export interface QueryResult {
  query: string;
  mode: 'bm25' | 'hybrid' | 'coldstart';
  rankOfFirstHit: number;
  recall5: number;
  recall10: number;
  mrr: number;
  latencyMs: number;
  contextCharsInjected: number;
}

export interface BenchmarkReport {
  timestamp: string;
  corpusDir: string;
  results: QueryResult[];
  summary: {
    bm25: ModeSummary;
    hybrid: ModeSummary | null;
    coldstart: ModeSummary | null;
  };
  tokenEfficiency: {
    avgContextCharsInjected: number;
    naiveCharsEstimate: number;
    savingsMultiplier: number;
  };
}

export interface ModeSummary {
  recall5: number;
  recall10: number;
  mrr: number;
  avgLatencyMs: number;
}

function summarise(results: QueryResult[], mode: 'bm25' | 'hybrid' | 'coldstart'): ModeSummary | null {
  const filtered = results.filter((r) => r.mode === mode);
  if (filtered.length === 0) return null;
  return {
    recall5: mean(filtered.map((r) => r.recall5)),
    recall10: mean(filtered.map((r) => r.recall10)),
    mrr: mean(filtered.map((r) => r.mrr)),
    avgLatencyMs: mean(filtered.map((r) => r.latencyMs)),
  };
}

export function buildReport(results: QueryResult[], corpusDir: string): BenchmarkReport {
  const bm25Summary = summarise(results, 'bm25')!;
  const hybridSummary = summarise(results, 'hybrid');
  const coldSummary = summarise(results, 'coldstart');

  const bm25Results = results.filter((r) => r.mode === 'bm25');
  const avgContextChars = mean(bm25Results.map((r) => r.contextCharsInjected));
  // Naive estimate: reading 5 full source files × ~10,000 chars avg
  const naiveCharsEstimate = 5 * 10_000;

  return {
    timestamp: new Date().toISOString(),
    corpusDir,
    results,
    summary: {
      bm25: bm25Summary,
      hybrid: hybridSummary,
      coldstart: coldSummary,
    },
    tokenEfficiency: {
      avgContextCharsInjected: Math.round(avgContextChars),
      naiveCharsEstimate,
      savingsMultiplier:
        avgContextChars > 0 ? Math.round(naiveCharsEstimate / avgContextChars) : 0,
    },
  };
}

export function printMarkdownTable(report: BenchmarkReport): void {
  const { summary, tokenEfficiency } = report;

  process.stdout.write('\n## holocron Benchmark Results\n\n');
  process.stdout.write(`Corpus: \`${report.corpusDir}\`  \n`);
  process.stdout.write(`Timestamp: ${report.timestamp}\n\n`);

  process.stdout.write(
    '| Mode | Recall@5 | Recall@10 | MRR | Avg Latency |\n' +
    '|------|----------|-----------|-----|-------------|\n',
  );

  const row = (label: string, s: ModeSummary | null) => {
    if (!s) return `| ${label} | — | — | — | — |\n`;
    return `| ${label} | ${pct(s.recall5)} | ${pct(s.recall10)} | ${s.mrr.toFixed(3)} | ${s.avgLatencyMs.toFixed(0)}ms |\n`;
  };

  process.stdout.write(row('BM25-only', summary.bm25));
  process.stdout.write(row('Hybrid (BM25+vec)', summary.hybrid));
  process.stdout.write(row('Cold-start restore', summary.coldstart));

  process.stdout.write('\n### Token Efficiency\n\n');
  process.stdout.write(
    `- Avg injected context: **${tokenEfficiency.avgContextCharsInjected.toLocaleString()} chars** (~${Math.round(tokenEfficiency.avgContextCharsInjected / 4).toLocaleString()} tokens)\n`,
  );
  process.stdout.write(
    `- Naive full-file read estimate: **${tokenEfficiency.naiveCharsEstimate.toLocaleString()} chars** (~${Math.round(tokenEfficiency.naiveCharsEstimate / 4).toLocaleString()} tokens)\n`,
  );
  process.stdout.write(
    `- Estimated savings: **${tokenEfficiency.savingsMultiplier}×** fewer tokens\n\n`,
  );
}

export function writeJsonReport(report: BenchmarkReport, outputDir: string): void {
  const outPath = join(outputDir, 'benchmark-results.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  process.stderr.write(`[benchmark] Results written to ${outPath}\n`);
}
