import React, { memo, useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChatEntryTool } from '../../../stores/messages.store';
import { Colors } from '../../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../../constants/typography';
import { ToolCard } from './ToolCard';
import { basenameOf, countMatches, resultToText } from './searchHelpers';

interface GlobCardProps {
  entry: ChatEntryTool;
}

interface GlobInput {
  pattern?: string;
  path?: string;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function GlobCardBase({ entry }: GlobCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const onToggle = useCallback(() => setExpanded((v) => !v), []);

  const input = entry.input as GlobInput;
  const pattern = typeof input.pattern === 'string' ? input.pattern : '';
  const path = typeof input.path === 'string' ? input.path : '';

  const text = useMemo(() => resultToText(entry.result), [entry.result]);
  const fileCount = useMemo(() => countMatches(text, 'lines'), [text]);

  let header: React.ReactNode = null;
  if (entry.state !== 'running') {
    const countColor = fileCount === 0 ? Colors.textSecondary : Colors.accent;
    header = (
      <View style={styles.headerInner}>
        {pattern.length > 0 && (
          <Text style={styles.pattern} numberOfLines={1}>
            {truncate(pattern, 24)}
          </Text>
        )}
        {path.length > 0 && (
          <Text style={styles.basename} numberOfLines={1}>
            {basenameOf(path)}
          </Text>
        )}
        <Text style={[styles.chip, { color: countColor }]}>{`${fileCount}`}</Text>
      </View>
    );
  }

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

        <Text style={[styles.label, styles.labelSpaced]}>files</Text>
        {text.length === 0 ? (
          <Text style={styles.empty}>(no matches)</Text>
        ) : (
          <ScrollView style={styles.scroll} nestedScrollEnabled>
            <Text style={styles.filesText} selectable>
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
  filesText: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body - 2,
    color: Colors.textPrimary,
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pattern: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
    color: Colors.textPrimary,
    maxWidth: 200,
  },
  basename: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
  },
  chip: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semiBold,
  },
  empty: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontStyle: 'italic',
    color: Colors.textSecondary,
  },
});

export const GlobCard = memo(GlobCardBase);
