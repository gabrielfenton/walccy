// ──────────────────────────────────────────────
// Walccy Design System — Tint
// Centralised semi-transparent variants of accent colors.
// 8-digit hex (#RRGGBBAA) is supported on all RN platforms.
// ──────────────────────────────────────────────

import { Colors } from './colors';

/**
 * Convert a 6-digit hex color + 0..1 alpha to an 8-digit hex (#RRGGBBAA).
 * RN supports 8-digit hex on all platforms.
 */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

export const Tint = {
  accentWeak:    withAlpha(Colors.accent,      0.10), // replaces +1A / +22
  accentMedium:  withAlpha(Colors.accent,      0.20), // replaces +33
  accentStrong:  withAlpha(Colors.accent,      0.40), // replaces +66
  dangerWeak:    withAlpha(Colors.accentRed,   0.15),
  warnWeak:      withAlpha(Colors.accentAmber, 0.15),
  successWeak:   withAlpha(Colors.accentGreen, 0.15),
} as const;
