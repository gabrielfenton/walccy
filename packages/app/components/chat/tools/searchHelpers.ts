// Search-specific helpers (Grep/Glob match counting).

/**
 * Count Grep/Glob match output. Modes:
 *   - 'content' / 'files_with_matches' → non-empty line count
 *   - 'count' → sum of `path:N` numerics (or bare-number lines)
 *
 * Older callers used 'lines'; we accept it as an alias for 'content' so the
 * signature change is backwards-compatible.
 */
export function countMatches(
  text: string,
  mode: 'count' | 'content' | 'files_with_matches' | 'lines',
): number {
  if (text.length === 0) return 0;
  const lines = text.split('\n').filter((l) => l.length > 0);
  if (mode !== 'count') return lines.length;
  let total = 0;
  for (const ln of lines) {
    const colon = ln.lastIndexOf(':');
    const numStr = colon >= 0 ? ln.slice(colon + 1) : ln;
    const n = Number.parseInt(numStr.trim(), 10);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}
