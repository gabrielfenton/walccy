import React, { memo, useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChatEntryTool } from '../../../stores/messages.store';
import { Colors } from '../../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../../constants/typography';
import { ToolCard } from './ToolCard';
import { resultToText } from './searchHelpers';

interface AgentCardProps {
  entry: ChatEntryTool;
}

interface AgentInput {
  description?: string;
  prompt?: string;
  subagent_type?: string;
  isolation?: string;
  model?: string;
  run_in_background?: boolean;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function AgentCardBase({ entry }: AgentCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const onToggle = useCallback(() => setExpanded((v) => !v), []);

  const input = entry.input as AgentInput;
  const description = typeof input.description === 'string' ? input.description : '';
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  const subagentType = typeof input.subagent_type === 'string' ? input.subagent_type : '';
  const model = typeof input.model === 'string' ? input.model : '';
  const isolation = typeof input.isolation === 'string' ? input.isolation : '';
  const background = input.run_in_background === true;
  const isWorktree = isolation === 'worktree';

  let header: React.ReactNode = null;
  if (entry.state !== 'running') {
    header = (
      <View style={styles.headerInner}>
        {description.length > 0 && (
          <Text style={styles.description} numberOfLines={1}>
            {truncate(description, 24)}
          </Text>
        )}
        {subagentType.length > 0 && (
          <Text style={styles.pill}>{subagentType}</Text>
        )}
        {model.length > 0 && <Text style={styles.modelChip}>{model}</Text>}
        {isWorktree && <Text style={styles.worktree}>⊞</Text>}
      </View>
    );
  }

  const report = resultToText(entry.result);

  return (
    <ToolCard
      toolName={entry.toolName}
      state={entry.state}
      header={header}
      expanded={expanded}
      onToggleExpand={onToggle}
    >
      <View>
        <Text style={styles.label}>description</Text>
        <Text style={styles.body} selectable>
          {description}
        </Text>

        <Text style={[styles.label, styles.labelSpaced]}>prompt</Text>
        <ScrollView style={styles.promptScroll} nestedScrollEnabled>
          <Text style={styles.promptText} selectable>
            {prompt}
          </Text>
        </ScrollView>

        <Text style={[styles.label, styles.labelSpaced]}>subagent</Text>
        <Text style={styles.mono} selectable>
          {subagentType}
        </Text>

        {(model.length > 0 || isWorktree || background) && (
          <View style={styles.chipRow}>
            {model.length > 0 && <Text style={styles.dimChip}>{`model: ${model}`}</Text>}
            {isWorktree && <Text style={styles.dimChip}>isolation: worktree</Text>}
            {background && <Text style={styles.dimChip}>background</Text>}
          </View>
        )}

        <Text style={[styles.label, styles.labelSpaced]}>report</Text>
        {report.length === 0 ? (
          <Text style={styles.empty}>(no report)</Text>
        ) : (
          <ScrollView style={styles.reportScroll} nestedScrollEnabled>
            <Text style={styles.reportText} selectable>
              {report}
            </Text>
          </ScrollView>
        )}
      </View>
    </ToolCard>
  );
}

const styles = StyleSheet.create({
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  description: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
    maxWidth: 180,
  },
  pill: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
    color: Colors.accent,
    backgroundColor: Colors.accent + '22',
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  modelChip: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
  },
  worktree: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
    color: Colors.accentAmber,
    fontWeight: FontWeight.semiBold,
  },
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
  body: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    color: Colors.textPrimary,
  },
  promptScroll: {
    maxHeight: 240,
  },
  promptText: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body - 1,
    color: Colors.textSecondary,
  },
  mono: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body,
    color: Colors.textPrimary,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  dimChip: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
  },
  reportScroll: {
    maxHeight: 400,
  },
  reportText: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body - 1,
    color: Colors.textPrimary,
  },
  empty: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontStyle: 'italic',
    color: Colors.textSecondary,
  },
});

export const AgentCard = memo(AgentCardBase);
