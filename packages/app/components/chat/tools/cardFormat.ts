// Generic formatting helpers shared across all tool cards.

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
