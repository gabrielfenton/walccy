import React, { memo, useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChatEntryTool } from '../../../stores/messages.store';
import { Colors } from '../../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../../constants/typography';
import { ToolCard, type ToolCardChip, type ToolCardHeaderData } from './ToolCard';
import { firstLine, resultToText, truncate } from './cardFormat';

interface AgentCardProps {
  entry: ChatEntryTool;
  sessionId: string;
}

interface AgentInput {
  description?: string;
  prompt?: string;
  subagent_type?: string;
  isolation?: string;
  model?: string;
  run_in_background?: boolean;
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

  const header = useMemo<ToolCardHeaderData>(() => {
    const identity = description.length > 0 ? truncate(description, 24) : undefined;
    const chips: ToolCardChip[] = [];
    if (entry.state !== 'running') {
      if (subagentType.length > 0) {
        chips.push({ text: subagentType, tone: 'accent', mono: true });
      }
      if (model.length > 0) {
        chips.push({ text: model, tone: 'neutral' });
      }
      if (isWorktree) {
        chips.push({ text: 'worktree', tone: 'warn' });
      }
    }
    let errorSummary: string | undefined;
    if (entry.state === 'error') {
      const line = firstLine(resultToText(entry.result)).trim();
      if (line.length > 0) errorSummary = truncate(line, 80);
    }
    return { identity, chips, errorSummary };
  }, [description, subagentType, model, isWorktree, entry.state, entry.result]);

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
