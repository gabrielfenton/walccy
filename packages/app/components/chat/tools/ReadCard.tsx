import React, { memo, useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChatEntryTool } from '../../../stores/messages.store';
import { Colors } from '../../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../../constants/typography';
import { ToolCard } from './ToolCard';

interface ReadCardProps {
  entry: ChatEntryTool;
}

interface ReadInput {
  file_path?: string;
  offset?: number;
  limit?: number;
}

function basenameOf(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1] ?? p;
}

function resultToText(result: unknown): string {
  if (!Array.isArray(result)) return '';
  const allText = result.every(
    (b): b is { type: 'text'; text: string } =>
      b != null &&
      typeof b === 'object' &&
      (b as { type?: unknown }).type === 'text' &&
      typeof (b as { text?: unknown }).text === 'string',
  );
  if (!allText) return '';
  return result.map((b) => b.text).join('');
}

function rangeLabel(offset: number | undefined, limit: number | undefined): string | null {
  const hasOffset = typeof offset === 'number';
  const hasLimit = typeof limit === 'number';
  if (hasOffset && hasLimit) return `${offset}–${(offset as number) + (limit as number) - 1}`;
  if (hasOffset) return `${offset}+`;
  if (hasLimit) return `1–${limit}`;
  return null;
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

  let header: React.ReactNode = null;
  if (entry.state !== 'running') {
    header = (
      <View style={styles.headerInner}>
        {filePath.length > 0 && (
          <Text style={styles.basename} numberOfLines={1}>
            {basenameOf(filePath)}
          </Text>
        )}
        {range != null && <Text style={styles.chip}>{range}</Text>}
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
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
    color: Colors.accent,
  },
  empty: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontStyle: 'italic',
    color: Colors.textSecondary,
  },
});

export const ReadCard = memo(ReadCardBase);
