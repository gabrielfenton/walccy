import React, { memo, useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChatEntryTool } from '../../../stores/messages.store';
import { Colors } from '../../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../../constants/typography';
import { ToolCard, type ToolCardChip, type ToolCardHeaderData } from './ToolCard';
import { firstLine, resultToText, truncate } from './cardFormat';

interface SkillCardProps {
  entry: ChatEntryTool;
  sessionId: string;
}

interface SkillInput {
  skill?: string;
  args?: string;
}

function SkillCardBase({ entry }: SkillCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const onToggle = useCallback(() => setExpanded((v) => !v), []);

  const input = entry.input as SkillInput;
  const skill = typeof input.skill === 'string' ? input.skill : '';
  const args = typeof input.args === 'string' ? input.args : '';

  const resultText = useMemo(() => resultToText(entry.result), [entry.result]);

  const header = useMemo<ToolCardHeaderData>(() => {
    const chips: ToolCardChip[] = [];
    let errorSummary: string | undefined;
    if (entry.state === 'error') {
      const line = firstLine(resultText).trim();
      if (line.length > 0) errorSummary = truncate(line, 80);
    } else {
      if (skill.length > 0) {
        chips.push({ text: skill, tone: 'accent', mono: true });
      }
      if (args.length > 0) {
        chips.push({ text: truncate(args, 24), tone: 'neutral' });
      }
    }
    return { chips, errorSummary };
  }, [skill, args, entry.state, resultText]);

  const resultEmpty = resultText.length === 0;

  return (
    <ToolCard
      toolName={entry.toolName}
      state={entry.state}
      header={header}
      expanded={expanded}
      onToggleExpand={onToggle}
    >
      <View>
        <Text style={styles.label}>skill</Text>
        <Text style={styles.mono} selectable>
          {skill}
        </Text>

        {args.length > 0 && (
          <>
            <Text style={[styles.label, styles.labelSpaced]}>args</Text>
            <Text style={styles.mono} selectable>
              {args}
            </Text>
          </>
        )}

        <Text style={[styles.label, styles.labelSpaced]}>output</Text>
        {resultEmpty && entry.state !== 'running' ? (
          <Text style={styles.empty}>(empty)</Text>
        ) : (
          <ScrollView style={styles.resultScroll} nestedScrollEnabled>
            <Text style={styles.resultText} selectable>
              {resultText}
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
  resultScroll: {
    maxHeight: 400,
  },
  resultText: {
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

export const SkillCard = memo(SkillCardBase);
