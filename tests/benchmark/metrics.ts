/**
 * Retrieval quality metrics for holocron benchmark.
 *
 * All functions are pure — no I/O, no side effects.
 */

/**
 * Recall@K: fraction of expected files that appear somewhere in the top-K results.
 *
 * A result file "matches" an expected file when the result path ends with the
 * expected relative path (handles absolute vs relative path mismatches).
 */
export function recallAtK(resultFiles: string[], expectedFiles: readonly string[], k: number): number {
  if (expectedFiles.length === 0) return 1;
  const topK = resultFiles.slice(0, k);
  const matched = expectedFiles.filter((exp) =>
    topK.some((res) => res.endsWith(exp) || exp.endsWith(res)),
  );
  return matched.length / expectedFiles.length;
}

/**
 * MRR (Mean Reciprocal Rank): 1 / rank of the first correct result.
 * Returns 0 if no expected file appears in the top-10.
 */
export function mrr(resultFiles: string[], expectedFiles: readonly string[]): number {
  for (let i = 0; i < Math.min(resultFiles.length, 10); i++) {
    const res = resultFiles[i];
    if (!res) continue;
    if (expectedFiles.some((exp) => res.endsWith(exp) || exp.endsWith(res))) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * Rank of first correct hit (1-indexed). Returns Infinity if not found in top-10.
 */
export function rankOfFirstHit(resultFiles: string[], expectedFiles: readonly string[]): number {
  for (let i = 0; i < Math.min(resultFiles.length, 10); i++) {
    const res = resultFiles[i];
    if (!res) continue;
    if (expectedFiles.some((exp) => res.endsWith(exp) || exp.endsWith(res))) {
      return i + 1;
    }
  }
  return Infinity;
}

/** Arithmetic mean of a number array. Returns 0 for empty arrays. */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Format a 0–1 fraction as a percentage string: "87.5%" */
export function pct(value: number): string {
  return (value * 100).toFixed(1) + '%';
}
