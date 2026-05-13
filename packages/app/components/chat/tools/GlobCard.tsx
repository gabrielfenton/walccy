import React, { memo, useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChatEntryTool } from '../../../stores/messages.store';
import { Colors } from '../../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../../constants/typography';
import { ToolCard, type ToolCardChip, type ToolCardHeaderData } from './ToolCard';
import { basenameOf, firstLine, resultToText, truncate } from './cardFormat';
import { countMatches } from './searchHelpers';

interface GlobCardProps {
  entry: ChatEntryTool;
  sessionId: string;
}

interface GlobInput {
  pattern?: string;
  path?: string;
}

function GlobCardBase({ entry }: GlobCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const onToggle = useCallback(() => setExpanded((v) => !v), []);

  const input = entry.input as GlobInput;
  const pattern = typeof input.pattern === 'string' ? input.pattern : '';
  const path = typeof input.path === 'string' ? input.path : '';

  const text = useMemo(() => resultToText(entry.result), [entry.result]);
  const fileCount = useMemo(() => countMatches(text, 'content'), [text]);

  const header = useMemo<ToolCardHeaderData>(() => {
    const identity = pattern.length > 0 ? truncate(pattern, 24) : undefined;
    const chips: ToolCardChip[] = [];
    if (entry.state !== 'running') {
      if (path.length > 0) {
        chips.push({ text: basenameOf(path), tone: 'neutral', mono: true });
      }
      chips.push({
        text: `${fileCount}`,
        tone: fileCount > 0 ? 'accent' : 'neutral',
      });
    }
    let errorSummary: string | undefined;
    if (entry.state === 'error') {
      const line = firstLine(resultToText(entry.result)).trim();
      if (line.length > 0) errorSummary = truncate(line, 80);
    }
    return { identity, chips, errorSummary };
  }, [pattern, path, fileCount, entry.state, entry.result]);

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
  empty: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontStyle: 'italic',
    color: Colors.textSecondary,
  },
});

export const GlobCard = memo(GlobCardBase);
