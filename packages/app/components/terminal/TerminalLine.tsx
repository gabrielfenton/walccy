// ──────────────────────────────────────────────
// Walccy — TerminalLine
// Renders a single buffered line with ANSI color support.
// ──────────────────────────────────────────────

import React, { memo, useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { parseAnsi } from '../../services/ansi-parser';
import { Colors } from '../../constants/colors';
import { FontFamily } from '../../constants/typography';
import type { BufferedLine } from '@walccy/protocol';
import type { TextSpan } from '../../services/ansi-parser';

// ──────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────

interface TerminalLineProps {
  line: BufferedLine;
  fontSize?: number;
  lineHeight?: number;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function getInputLineColor(line: BufferedLine): string | undefined {
  if (line.source !== 'input') return undefined;
  if (line.inputClientId === 'self') return Colors.accent;
  return Colors.textSecondary;
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function TerminalLineBase({ line, fontSize = 13, lineHeight = 1.5 }: TerminalLineProps): React.ReactElement {
  // Memoize ANSI parsing: line content is immutable once buffered, so we key
  // on `line.index` (monotonic, stable). On FlashList recycling the index
  // changes, invalidating the cache; for the same line, we skip re-parsing.
  const spans: TextSpan[] = useMemo(() => parseAnsi(line.rawContent), [line.index]);
  const inputColor = getInputLineColor(line);

  return (
    <Text
      style={[
        styles.lineContainer,
        {
          fontSize,
          lineHeight: fontSize * lineHeight,
          color: inputColor ?? Colors.textMono,
        },
      ]}
    >
      {spans.map((span, index) => {
        // For input lines, use the tint color uniformly; ignore span colors
        const textColor = inputColor ?? span.color ?? Colors.textMono;
        const bgColor = inputColor ? undefined : span.bgColor;
        const weight: 'bold' | 'normal' = span.bold ? 'bold' : 'normal';
        const style: 'italic' | 'normal' = span.italic ? 'italic' : 'normal';

        return (
          <Text
            key={index}
            style={[
              styles.span,
              {
                color: textColor,
                backgroundColor: bgColor,
                fontWeight: weight,
                fontStyle: style,
                fontSize,
              },
            ]}
          >
            {span.text}
          </Text>
        );
      })}
    </Text>
  );
}

export const TerminalLine = memo(TerminalLineBase);

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  lineContainer: {
    fontFamily: FontFamily.mono,
    paddingHorizontal: 12,
    paddingVertical: 1,
    flexWrap: 'wrap',
    color: Colors.textMono,
  },
  span: {
    fontFamily: FontFamily.mono,
  },
});
