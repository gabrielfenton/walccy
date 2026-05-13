import React, { memo, useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChatEntryTool } from '../../../stores/messages.store';
import { Colors } from '../../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../../constants/typography';
import { ToolCard, type ToolCardChip, type ToolCardHeaderData } from './ToolCard';
import { firstLine, resultToText, truncate } from './searchHelpers';

interface WebSearchCardProps {
  entry: ChatEntryTool;
}

interface WebSearchInput {
  query?: string;
  allowed_domains?: string[];
  blocked_domains?: string[];
}

function nonEmptyStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((d): d is string => typeof d === 'string' && d.length > 0);
}

function WebSearchCardBase({ entry }: WebSearchCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const onToggle = useCallback(() => setExpanded((v) => !v), []);

  const input = entry.input as WebSearchInput;
  const query = typeof input.query === 'string' ? input.query : '';
  const allowed = useMemo(() => nonEmptyStrings(input.allowed_domains), [input.allowed_domains]);
  const blocked = useMemo(() => nonEmptyStrings(input.blocked_domains), [input.blocked_domains]);

  const text = useMemo(() => resultToText(entry.result), [entry.result]);

  const header = useMemo<ToolCardHeaderData>(() => {
    const identity = query.length > 0 ? truncate(query, 36) : undefined;
    const chips: ToolCardChip[] = [];
    if (entry.state !== 'running') {
      const domainCount = allowed.length + blocked.length;
      if (domainCount > 0) {
        chips.push({
          text: `+${domainCount} ${domainCount === 1 ? 'domain' : 'domains'}`,
          tone: 'neutral',
          mono: false,
        });
      }
    }
    let errorSummary: string | undefined;
    if (entry.state === 'error') {
      const line = firstLine(resultToText(entry.result)).trim();
      if (line.length > 0) errorSummary = truncate(line, 80);
    }
    return { identity, chips, errorSummary };
  }, [query, allowed.length, blocked.length, entry.state, entry.result]);

  return (
    <ToolCard
      toolName={entry.toolName}
      state={entry.state}
      header={header}
      expanded={expanded}
      onToggleExpand={onToggle}
    >
      <View>
        <Text style={styles.label}>query</Text>
        <Text style={styles.queryText} selectable>
          {query}
        </Text>

        {allowed.length > 0 && (
          <View style={styles.chipsBlock}>
            <Text style={styles.label}>allowed</Text>
            <View style={styles.chipsRow}>
              {allowed.map((d) => (
                <Text key={`a-${d}`} style={styles.pill}>
                  {d}
                </Text>
              ))}
            </View>
          </View>
        )}

        {blocked.length > 0 && (
          <View style={styles.chipsBlock}>
            <Text style={styles.label}>blocked</Text>
            <View style={styles.chipsRow}>
              {blocked.map((d) => (
                <Text key={`b-${d}`} style={styles.pill}>
                  {d}
                </Text>
              ))}
            </View>
          </View>
        )}

        <Text style={[styles.label, styles.labelSpaced]}>results</Text>
        {text.length === 0 ? (
          <Text style={styles.empty}>(no results)</Text>
        ) : (
          <ScrollView style={styles.scroll} nestedScrollEnabled>
            <Text style={styles.resultsText} selectable>
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
  queryText: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    color: Colors.textPrimary,
    flexWrap: 'wrap',
  },
  scroll: {
    maxHeight: 400,
  },
  resultsText: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body - 2,
    color: Colors.textPrimary,
  },
  chipsBlock: {
    marginTop: 10,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pill: {
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

export const WebSearchCard = memo(WebSearchCardBase);
