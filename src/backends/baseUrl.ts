const SLASH = 0x2f; // '/'

/**
 * Remove every trailing '/' from a base URL.
 *
 * Deliberately not `url.replace(/\/+$/, '')`: that regex backtracks on input
 * with a long run of slashes that is not at the end (e.g. '/'.repeat(n) + 'x'),
 * because the engine retries the `\/+` match from every start position,
 * which is O(n²). The base URL can come from config files and environment
 * variables, so this scans backwards once instead: O(n), no regex.
 */
export function trimTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === SLASH) end--;
  return end === url.length ? url : url.slice(0, end);
}
