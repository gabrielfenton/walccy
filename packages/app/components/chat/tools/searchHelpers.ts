// Shared helpers for Grep/Glob cards.

export function resultToText(result: unknown): string {
  if (!Array.isArray(result)) return '';
  const allText = result.every(
    (b): b is { type: 'text'; text: string } =>
      b != null &&
      typeof b === 'object' &&
      (b as { type?: unknown }).type === 'text' &&
      typeof (b as { text?: unknown }).text === 'string',
  );
  if (!allText) return '';
  return result.map((b) => b.text).join('');
}

// Counts non-empty lines. For Grep `output_mode:'count'` the body contains
// `path:N` lines (or a single bare number when no path given) — sum those.
export function countMatches(text: string, mode: 'lines' | 'count'): number {
  if (text.length === 0) return 0;
  const lines = text.split('\n').filter((l) => l.length > 0);
  if (mode === 'lines') return lines.length;
  let total = 0;
  for (const ln of lines) {
    const colon = ln.lastIndexOf(':');
    const numStr = colon >= 0 ? ln.slice(colon + 1) : ln;
    const n = Number.parseInt(numStr.trim(), 10);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

export function basenameOf(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1] ?? p;
}
