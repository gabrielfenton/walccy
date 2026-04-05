// ──────────────────────────────────────────────
// Walccy — ANSI escape code parser
// ──────────────────────────────────────────────

export interface TextSpan {
  text: string;
  color?: string;      // hex color
  bgColor?: string;    // hex background color
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
}

// ──────────────────────────────────────────────
// Full xterm 256-color palette
// ──────────────────────────────────────────────

// Standard 16 colors (0-15)
// 216 color cube (16-231)
// Grayscale (232-255)

export const XTERM_256: string[] = (() => {
  const palette: string[] = [];

  // 0-15: standard + high-intensity colors
  const base16 = [
    '#000000', '#800000', '#008000', '#808000',
    '#000080', '#800080', '#008080', '#c0c0c0',
    '#808080', '#ff0000', '#00ff00', '#ffff00',
    '#0000ff', '#ff00ff', '#00ffff', '#ffffff',
  ];
  for (const c of base16) palette.push(c);

  // 16-231: 6×6×6 color cube
  const levels = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        const rv = levels[r]!;
        const gv = levels[g]!;
        const bv = levels[b]!;
        palette.push(
          '#' +
            rv.toString(16).padStart(2, '0') +
            gv.toString(16).padStart(2, '0') +
            bv.toString(16).padStart(2, '0')
        );
      }
    }
  }

  // 232-255: grayscale ramp
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    const h = v.toString(16).padStart(2, '0');
    palette.push('#' + h + h + h);
  }

  return palette;
})();

// ──────────────────────────────────────────────
// Standard 8/16 ANSI color maps
// ──────────────────────────────────────────────

/** Map SGR 30-37 foreground codes to xterm hex */
const FG_STANDARD: Record<number, string> = {
  30: '#000000',
  31: '#800000',
  32: '#008000',
  33: '#808000',
  34: '#000080',
  35: '#800080',
  36: '#008080',
  37: '#c0c0c0',
};

/** Map SGR 90-97 bright foreground codes to xterm hex */
const FG_BRIGHT: Record<number, string> = {
  90: '#808080',
  91: '#ff0000',
  92: '#00ff00',
  93: '#ffff00',
  94: '#0000ff',
  95: '#ff00ff',
  96: '#00ffff',
  97: '#ffffff',
};

/** Map SGR 40-47 background codes to xterm hex */
const BG_STANDARD: Record<number, string> = {
  40: '#000000',
  41: '#800000',
  42: '#008000',
  43: '#808000',
  44: '#000080',
  45: '#800080',
  46: '#008080',
  47: '#c0c0c0',
};

/** Map SGR 100-107 bright background codes to xterm hex */
const BG_BRIGHT: Record<number, string> = {
  100: '#808080',
  101: '#ff0000',
  102: '#00ff00',
  103: '#ffff00',
  104: '#0000ff',
  105: '#ff00ff',
  106: '#00ffff',
  107: '#ffffff',
};

// ──────────────────────────────────────────────
// Internal state type
// ──────────────────────────────────────────────

interface AnsiState {
  color?: string;
  bgColor?: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
}

function defaultState(): AnsiState {
  return { bold: false, italic: false, underline: false, dim: false };
}

function stateToSpanProps(
  state: AnsiState
): Omit<TextSpan, 'text'> {
  const props: Omit<TextSpan, 'text'> = {};
  if (state.color !== undefined) props.color = state.color;
  if (state.bgColor !== undefined) props.bgColor = state.bgColor;
  if (state.bold) props.bold = true;
  if (state.italic) props.italic = true;
  if (state.underline) props.underline = true;
  if (state.dim) props.dim = true;
  return props;
}

// ──────────────────────────────────────────────
// SGR parameter processor
// ──────────────────────────────────────────────

function applySgr(params: number[], state: AnsiState): void {
  let i = 0;
  while (i < params.length) {
    const p = params[i]!;

    if (p === 0) {
      // Reset all
      state.color = undefined;
      state.bgColor = undefined;
      state.bold = false;
      state.italic = false;
      state.underline = false;
      state.dim = false;
    } else if (p === 1) {
      state.bold = true;
    } else if (p === 2) {
      state.dim = true;
    } else if (p === 3) {
      state.italic = true;
    } else if (p === 4) {
      state.underline = true;
    } else if (p === 22) {
      state.bold = false;
      state.dim = false;
    } else if (p === 23) {
      state.italic = false;
    } else if (p === 24) {
      state.underline = false;
    } else if (p >= 30 && p <= 37) {
      state.color = FG_STANDARD[p];
    } else if (p === 38) {
      // Extended fg color
      const mode = params[i + 1];
      if (mode === 5) {
        // 256-color
        const idx = params[i + 2];
        if (idx !== undefined && idx >= 0 && idx <= 255) {
          state.color = XTERM_256[idx];
        }
        i += 2;
      } else if (mode === 2) {
        // 24-bit true color
        const r = params[i + 2] ?? 0;
        const g = params[i + 3] ?? 0;
        const b = params[i + 4] ?? 0;
        state.color =
          '#' +
          r.toString(16).padStart(2, '0') +
          g.toString(16).padStart(2, '0') +
          b.toString(16).padStart(2, '0');
        i += 4;
      }
    } else if (p === 39) {
      state.color = undefined;
    } else if (p >= 40 && p <= 47) {
      state.bgColor = BG_STANDARD[p];
    } else if (p === 48) {
      // Extended bg color
      const mode = params[i + 1];
      if (mode === 5) {
        const idx = params[i + 2];
        if (idx !== undefined && idx >= 0 && idx <= 255) {
          state.bgColor = XTERM_256[idx];
        }
        i += 2;
      } else if (mode === 2) {
        const r = params[i + 2] ?? 0;
        const g = params[i + 3] ?? 0;
        const b = params[i + 4] ?? 0;
        state.bgColor =
          '#' +
          r.toString(16).padStart(2, '0') +
          g.toString(16).padStart(2, '0') +
          b.toString(16).padStart(2, '0');
        i += 4;
      }
    } else if (p === 49) {
      state.bgColor = undefined;
    } else if (p >= 90 && p <= 97) {
      state.color = FG_BRIGHT[p];
    } else if (p >= 100 && p <= 107) {
      state.bgColor = BG_BRIGHT[p];
    }

    i++;
  }
}

// ──────────────────────────────────────────────
// Main parser
// ──────────────────────────────────────────────

// Matches ESC sequences:
//  - CSI sequences: ESC [ ... final-byte
//  - OSC sequences: ESC ] ... ST (or BEL)
//  - Other 2-char ESC sequences
const ESC_RE = /\x1b(?:\[[0-9;:<=>?]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[^[\]])/g;

// CSI SGR: ESC [ <params> m
const SGR_RE = /^\x1b\[([0-9;]*)m$/;

/**
 * Parse a raw terminal string (may include ANSI escape codes) into an array
 * of styled text spans.
 */
export function parseAnsi(raw: string): TextSpan[] {
  const spans: TextSpan[] = [];
  const state: AnsiState = defaultState();

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset global regex state
  ESC_RE.lastIndex = 0;

  // eslint-disable-next-line no-cond-assign
  while ((match = ESC_RE.exec(raw)) !== null) {
    const escStart = match.index;
    const escEnd = escStart + match[0].length;

    // Emit text before this escape sequence
    if (escStart > lastIndex) {
      const text = raw.slice(lastIndex, escStart);
      emitText(spans, text, state);
    }

    lastIndex = escEnd;

    // Process only SGR sequences — ignore all others (cursor movement, etc.)
    const sgrMatch = SGR_RE.exec(match[0]);
    if (sgrMatch) {
      const paramStr = sgrMatch[1] ?? '';
      const params =
        paramStr === ''
          ? [0]
          : paramStr.split(';').map((s) => (s === '' ? 0 : parseInt(s, 10)));
      applySgr(params, state);
    }
  }

  // Emit any remaining text
  if (lastIndex < raw.length) {
    emitText(spans, raw.slice(lastIndex), state);
  }

  return spans;
}

/**
 * Emit text, splitting on newlines so each line boundary is a separate span.
 * This allows consumers to handle line-wrapping and per-line rendering.
 */
function emitText(spans: TextSpan[], text: string, state: AnsiState): void {
  if (!text) return;
  const props = stateToSpanProps(state);
  // Split on \n but keep the delimiter accessible
  const parts = text.split('\n');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part.length > 0) {
      spans.push({ text: part, ...props });
    }
    // Add a newline marker span between parts (not after the last)
    if (i < parts.length - 1) {
      spans.push({ text: '\n', ...props });
    }
  }
}

// ──────────────────────────────────────────────
// Strip all ANSI codes
// ──────────────────────────────────────────────

const STRIP_RE = /\x1b(?:\[[0-9;:<=>?]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[^[\]])/g;

/**
 * Remove all ANSI escape codes from a string, returning plain text.
 */
export function stripAnsi(raw: string): string {
  return raw.replace(STRIP_RE, '');
}
