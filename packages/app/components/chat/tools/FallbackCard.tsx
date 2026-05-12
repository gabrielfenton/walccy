import React, { memo, useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChatEntryTool } from '../../../stores/messages.store';
import { Colors } from '../../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../../constants/typography';
import { ToolCard } from './ToolCard';

interface FallbackCardProps {
  entry: ChatEntryTool;
}

function renderResult(result: unknown): string {
  if (Array.isArray(result)) {
    const allText = result.every(
      (b): b is { type: 'text'; text: string } =>
        b != null &&
        typeof b === 'object' &&
        (b as { type?: unknown }).type === 'text' &&
        typeof (b as { text?: unknown }).text === 'string',
    );
    if (allText) return result.map((b) => b.text).join('');
  }
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function isEmptyResult(result: unknown): boolean {
  if (result == null) return true;
  if (typeof result === 'string') return result.length === 0;
  if (Array.isArray(result)) return result.length === 0;
  return false;
}

function FallbackCardBase({ entry }: FallbackCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const onToggle = useCallback(() => setExpanded((v) => !v), []);

  const header =
    entry.state === 'error' ? (
      <Text style={styles.headerSummary}>error</Text>
    ) : null;

  const showResult = !isEmptyResult(entry.result);
  const inputJson = JSON.stringify(entry.input, null, 2);

  return (
    <ToolCard
      toolName={entry.toolName}
      state={entry.state}
      header={header}
      expanded={expanded}
      onToggleExpand={onToggle}
    >
      <ScrollView style={styles.scroll} nestedScrollEnabled>
        <Text style={styles.label}>input</Text>
        <Text style={styles.mono}>{inputJson}</Text>
        {showResult && (
          <>
            <Text style={[styles.label, styles.labelSpaced]}>result</Text>
            <Text style={styles.mono}>{renderResult(entry.result)}</Text>
          </>
        )}
      </ScrollView>
    </ToolCard>
  );
}

const styles = StyleSheet.create({
  scroll: {
    maxHeight: 320,
  },
  label: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semiBold,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  labelSpaced: {
    marginTop: 8,
  },
  mono: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body - 2,
    color: Colors.textSecondary,
  },
  headerSummary: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    color: Colors.accentRed,
  },
});

export const FallbackCard = memo(FallbackCardBase);
