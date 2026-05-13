import React, { memo, useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChatEntryTool } from '../../../stores/messages.store';
import { Colors } from '../../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../../constants/typography';
import { ToolCard, type ToolCardChip, type ToolCardHeaderData } from './ToolCard';
import { basenameOf, resultToText, truncate } from './searchHelpers';

interface ReadCardProps {
  entry: ChatEntryTool;
}

interface ReadInput {
  file_path?: string;
  offset?: number;
  limit?: number;
}

function firstLine(s: string): string {
  const i = s.indexOf('\n');
  return i >= 0 ? s.slice(0, i) : s;
}

/**
 * Read tool is 1-indexed in the result line numbers, so an `offset:0` means
 * "from the very beginning" — render as `1+`. With both offset and limit
 * we show an inclusive range `${offset}–${offset+limit-1}`. We only emit a
 * range chip when at least one of offset/limit was provided.
 */
function rangeLabel(offset: number | undefined, limit: number | undefined): string | null {
  const hasOffset = typeof offset === 'number';
  const hasLimit = typeof limit === 'number';
  if (!hasOffset && !hasLimit) return null;
  if (hasOffset && hasLimit) {
    const start = offset === 0 ? 1 : (offset as number);
    return `${start}–${start + (limit as number) - 1}`;
  }
  if (hasOffset) {
    const start = offset === 0 ? 1 : (offset as number);
    return `${start}+`;
  }
  return `1–${limit}`;
}

function ReadCardBase({ entry }: ReadCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const onToggle = useCallback(() => setExpanded((v) => !v), []);

  const input = entry.input as ReadInput;
  const filePath = typeof input.file_path === 'string' ? input.file_path : '';
  const offset = typeof input.offset === 'number' ? input.offset : undefined;
  const limit = typeof input.limit === 'number' ? input.limit : undefined;

  const text = useMemo(() => resultToText(entry.result), [entry.result]);
  const range = useMemo(() => rangeLabel(offset, limit), [offset, limit]);

  const header = useMemo<ToolCardHeaderData>(() => {
    const identity = basenameOf(filePath);
    const chips: ToolCardChip[] = [];
    if (entry.state !== 'running' && range != null) {
      chips.push({ text: range, tone: 'accent' });
    }
    let errorSummary: string | undefined;
    if (entry.state === 'error') {
      const line = firstLine(resultToText(entry.result)).trim();
      if (line.length > 0) errorSummary = truncate(line, 80);
    }
    return {
      identity: identity.length > 0 ? identity : undefined,
      chips,
      errorSummary,
    };
  }, [filePath, range, entry.state, entry.result]);

  return (
    <ToolCard
      toolName={entry.toolName}
      state={entry.state}
      header={header}
      expanded={expanded}
      onToggleExpand={onToggle}
    >
      <View>
        <Text style={styles.label}>file</Text>
        <Text style={styles.filePath} selectable>
          {filePath}
        </Text>

        <Text style={[styles.label, styles.labelSpaced]}>content</Text>
        {text.length === 0 ? (
          <Text style={styles.empty}>(empty)</Text>
        ) : (
          <ScrollView style={styles.scroll} nestedScrollEnabled>
            <Text style={styles.contentText} selectable>
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
  filePath: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body,
    color: Colors.textPrimary,
    flexWrap: 'wrap',
  },
  scroll: {
    maxHeight: 400,
  },
  contentText: {
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

export const ReadCard = memo(ReadCardBase);
