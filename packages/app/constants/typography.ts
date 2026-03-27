// ──────────────────────────────────────────────
// Walccy Design System — Typography
// ──────────────────────────────────────────────

export const FontFamily = {
  /** Primary UI font */
  ui:       'Inter',
  /** Terminal / monospace font */
  mono:     'JetBrains Mono',
  /** Alternative monospace options */
  firaCode: 'Fira Code',
  cascadia:  'Cascadia Code',
} as const;

export type MonoFontFamily = 'JetBrains Mono' | 'Fira Code' | 'Cascadia Code';

export const FontSize = {
  /** Terminal output */
  terminal:   13,
  /** General body text */
  body:       14,
  /** Text inputs */
  input:      15,
  /** Tab bar labels */
  tabLabel:   12,
  /** Small labels / captions */
  caption:    11,
  /** Section headers */
  heading:    17,
  /** Large titles */
  title:      20,
} as const;

export const FontWeight = {
  regular:    '400' as const,
  medium:     '500' as const,
  semiBold:   '600' as const,
  bold:       '700' as const,
} as const;

export const LineHeight = {
  terminal:   1.4,
  body:       1.5,
  heading:    1.3,
} as const;
