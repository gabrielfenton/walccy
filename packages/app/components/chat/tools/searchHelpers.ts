// Canonical helpers shared across all tool cards.

/**
 * Convert a tool result into plain text.
 *
 * Handles:
 *   - string → returned as-is
 *   - Array  → text blocks ({type:'text', text:string}) are concatenated.
 *              Non-text blocks (images, etc.) are silently filtered, NOT a
 *              hard failure — the previous `every`-check returned '' as soon
 *              as a single non-text block appeared, which silently dropped
 *              real output. That bug is fixed here.
 *   - anything else → ''
 */
export function resultToText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (!Array.isArray(result)) return '';
  const parts: string[] = [];
  for (const b of result) {
    if (
      b != null &&
      typeof b === 'object' &&
      (b as { type?: unknown }).type === 'text' &&
      typeof (b as { text?: unknown }).text === 'string'
    ) {
      parts.push((b as { text: string }).text);
    }
  }
  return parts.join('');
}

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

export function basenameOf(p: string | undefined): string {
  if (typeof p !== 'string' || p.length === 0) return '';
  const parts = p.split('/');
  return parts[parts.length - 1] ?? '';
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

export function firstLine(s: string): string {
  const i = s.indexOf('\n');
  return i >= 0 ? s.slice(0, i) : s;
}
