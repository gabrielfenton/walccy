import React, { memo, useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChatEntryTool } from '../../../stores/messages.store';
import { Colors } from '../../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../../constants/typography';
import { ToolCard, type ToolCardChip, type ToolCardHeaderData } from './ToolCard';
import { basenameOf, countMatches, resultToText, truncate } from './searchHelpers';

interface GrepCardProps {
  entry: ChatEntryTool;
}

interface GrepInput {
  pattern?: string;
  path?: string;
  output_mode?: 'content' | 'files_with_matches' | 'count';
  glob?: string;
  type?: string;
  '-i'?: boolean;
  '-n'?: boolean;
  '-A'?: number;
  '-B'?: number;
  '-C'?: number;
  head_limit?: number;
  multiline?: boolean;
}

const REGEX_HINT = /[\\^$.*+?()[\]{}|]/;

function looksRegex(p: string): boolean {
  return REGEX_HINT.test(p);
}

function firstLine(s: string): string {
  const i = s.indexOf('\n');
  return i >= 0 ? s.slice(0, i) : s;
}

function GrepCardBase({ entry }: GrepCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const onToggle = useCallback(() => setExpanded((v) => !v), []);

  const input = entry.input as GrepInput;
  const pattern = typeof input.pattern === 'string' ? input.pattern : '';
  const path = typeof input.path === 'string' ? input.path : '';
  const outputMode = input.output_mode;

  const text = useMemo(() => resultToText(entry.result), [entry.result]);
  const matchCount = useMemo(
    () => countMatches(text, outputMode === 'count' ? 'count' : 'content'),
    [text, outputMode],
  );

  const flags = useMemo(() => {
    const f: string[] = [];
    if (input['-i'] === true) f.push('-i');
    if (input['-n'] === true) f.push('-n');
    if (typeof input['-A'] === 'number') f.push(`-A ${input['-A']}`);
    if (typeof input['-B'] === 'number') f.push(`-B ${input['-B']}`);
    if (typeof input['-C'] === 'number') f.push(`-C ${input['-C']}`);
    if (input.multiline === true) f.push('multiline');
    if (typeof input.type === 'string' && input.type.length > 0) f.push(`type=${input.type}`);
    if (typeof input.glob === 'string' && input.glob.length > 0) f.push(`glob=${input.glob}`);
    if (outputMode === 'files_with_matches' || outputMode === 'count') {
      f.push(`output_mode=${outputMode}`);
    }
    return f;
  }, [input, outputMode]);

  const header = useMemo<ToolCardHeaderData>(() => {
    const truncated = truncate(pattern, 24);
    const identity =
      pattern.length > 0
        ? looksRegex(pattern)
          ? `/${truncated}/`
          : truncated
        : undefined;
    const chips: ToolCardChip[] = [];
    if (entry.state !== 'running') {
      if (path.length > 0) {
        chips.push({ text: basenameOf(path), tone: 'neutral', mono: true });
      }
      chips.push({
        text: `${matchCount}`,
        tone: matchCount > 0 ? 'accent' : 'neutral',
      });
    }
    let errorSummary: string | undefined;
    if (entry.state === 'error') {
      const line = firstLine(resultToText(entry.result)).trim();
      if (line.length > 0) errorSummary = truncate(line, 80);
    }
    return { identity, chips, errorSummary };
  }, [pattern, path, matchCount, entry.state, entry.result]);

  return (
    <ToolCard
      toolName={entry.toolName}
      state={entry.state}
      header={header}
      expanded={expanded}
      onToggleExpand={onToggle}
    >
      <View>
        <Text style={styles.label}>pattern</Text>
        <Text style={styles.mono} selectable>
          {pattern}
        </Text>

        <Text style={[styles.label, styles.labelSpaced]}>path</Text>
        <Text style={styles.mono} selectable>
          {path.length > 0 ? path : './'}
        </Text>

        {flags.length > 0 && (
          <View style={styles.flagsRow}>
            {flags.map((f) => (
              <Text key={f} style={styles.flagChip}>
                {f}
              </Text>
            ))}
          </View>
        )}

        <Text style={[styles.label, styles.labelSpaced]}>matches</Text>
        {text.length === 0 ? (
          <Text style={styles.empty}>(no matches)</Text>
        ) : (
          <ScrollView style={styles.scroll} nestedScrollEnabled>
            <Text style={styles.matchesText} selectable>
              {text}
            </Text>
          </ScrollView>
        )}
      </View>
    </ToolCard>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semiBold,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  labelSpaced: {
    marginTop: 10,
  },
  mono: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body,
    color: Colors.textPrimary,
    flexWrap: 'wrap',
  },
  scroll: {
    maxHeight: 400,
  },
  matchesText: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body - 2,
    color: Colors.textPrimary,
  },
  flagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  flagChip: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: Colors.surface,
    borderRadius: 4,
  },
  empty: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontStyle: 'italic',
    color: Colors.textSecondary,
  },
});

export const GrepCard = memo(GrepCardBase);
