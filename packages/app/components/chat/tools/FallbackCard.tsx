import React, { memo, useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import type { ChatEntryTool } from '../../../stores/messages.store';
import { Colors } from '../../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../../constants/typography';
import { ToolCard, type ToolCardHeaderData } from './ToolCard';
import { resultToText, truncate } from './searchHelpers';

interface FallbackCardProps {
  entry: ChatEntryTool;
}

function renderResult(result: unknown): string {
  const asText = resultToText(result);
  if (asText.length > 0) return asText;
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

function firstLine(s: string): string {
  const i = s.indexOf('\n');
  return i >= 0 ? s.slice(0, i) : s;
}

function FallbackCardBase({ entry }: FallbackCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const onToggle = useCallback(() => setExpanded((v) => !v), []);

  const header = useMemo<ToolCardHeaderData>(() => {
    if (entry.state === 'error') {
      const line = firstLine(resultToText(entry.result)).trim();
      return { errorSummary: line.length > 0 ? truncate(line, 80) : 'error' };
    }
    return {};
  }, [entry.state, entry.result]);

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
});

export const FallbackCard = memo(FallbackCardBase);
