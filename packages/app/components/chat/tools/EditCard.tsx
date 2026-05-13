import React, { memo, useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { diffLines } from 'diff';
import type { ChatEntryTool } from '../../../stores/messages.store';
import { Colors } from '../../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../../constants/typography';
import { ToolCard } from './ToolCard';

interface EditCardProps {
  entry: ChatEntryTool;
}

interface EditInput {
  file_path?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
}

function basenameOf(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1] ?? p;
}

function EditCardBase({ entry }: EditCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const onToggle = useCallback(() => setExpanded((v) => !v), []);

  const input = entry.input as EditInput;
  const filePath = typeof input.file_path === 'string' ? input.file_path : '';
  const oldStr = typeof input.old_string === 'string' ? input.old_string : '';
  const newStr = typeof input.new_string === 'string' ? input.new_string : '';
  const replaceAll = input.replace_all === true;

  // diff package is sync — useMemo so re-render doesn't recompute for large files.
  const hunks = useMemo(() => diffLines(oldStr, newStr), [oldStr, newStr]);

  const { added, removed } = useMemo(() => {
    let a = 0;
    let r = 0;
    for (const h of hunks) {
      const c = h.count ?? 0;
      if (h.added) a += c;
      else if (h.removed) r += c;
    }
    return { added: a, removed: r };
  }, [hunks]);

  let header: React.ReactNode = null;
  if (entry.state !== 'running') {
    header = (
      <View style={styles.headerInner}>
        {filePath.length > 0 && (
          <Text style={styles.basename} numberOfLines={1}>
            {basenameOf(filePath)}
            {replaceAll && <Text style={styles.allSuffix}> ·all</Text>}
          </Text>
        )}
        <Text style={[styles.chip, { color: Colors.accentGreen }]}>{`+${added}`}</Text>
        <Text style={[styles.chip, { color: Colors.accentRed }]}>{`-${removed}`}</Text>
      </View>
    );
  }

  const empty = oldStr.length === 0 && newStr.length === 0;

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

        <Text style={[styles.label, styles.labelSpaced]}>diff</Text>
        {empty ? (
          <Text style={styles.empty}>(no change)</Text>
        ) : (
          <ScrollView style={styles.scroll} nestedScrollEnabled>
            {hunks.map((h, hi) => {
              const lines = h.value.split('\n');
              if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
              const isAdd = h.added === true;
              const isRem = h.removed === true;
              const prefix = isAdd ? '+ ' : isRem ? '- ' : '  ';
              const color = isAdd
                ? Colors.accentGreen
                : isRem
                  ? Colors.accentRed
                  : Colors.textSecondary;
              const bg = isAdd
                ? Colors.accentGreen + '15'
                : isRem
                  ? Colors.accentRed + '15'
                  : 'transparent';
              return lines.map((ln, li) => (
                <Text
                  key={`${hi}-${li}`}
                  style={[styles.diffLine, { color, backgroundColor: bg }]}
                  selectable
                >
                  {prefix}
                  {ln}
                </Text>
              ));
            })}
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
  diffLine: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body - 2,
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
  allSuffix: {
    color: Colors.accentAmber,
  },
  chip: {
    fontFamily: FontFamily.ui,
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

export const EditCard = memo(EditCardBase);
