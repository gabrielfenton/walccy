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

/**
 * Strip Unicode Format (Cf) chars — RTL/LRO/PDF marks, ZWJ, ZWNJ, BOMs.
 * They can flip the visual order of model-controlled labels so the user
 * sees text different from what's sent back to the daemon.
 */
export function stripFormatChars(s: string): string {
  return s.replace(/\p{Cf}/gu, '');
}

/**
 * Link-scheme allowlist for markdown-rendered model output.
 * Returning false from `onLinkPress` suppresses Linking.openURL — this
 * prevents `[x](myapp://…)`, `tel:`, `file:`, etc. deep-link auto-open.
 */
export function isSafeLink(url: string): boolean {
  return /^https?:\/\//i.test(url) || /^mailto:/i.test(url);
}
