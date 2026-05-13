import React, { memo, useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChatEntryTool } from '../../../stores/messages.store';
import { Colors } from '../../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../../constants/typography';
import { ToolCard, type ToolCardChip, type ToolCardHeaderData } from './ToolCard';
import { resultToText, truncate } from './searchHelpers';

interface BashCardProps {
  entry: ChatEntryTool;
}

// Shape from the Claude Code SDK Bash tool input.
interface BashInput {
  command?: string;
  description?: string;
  run_in_background?: boolean;
  timeout?: number;
}

function firstLine(s: string): string {
  const i = s.indexOf('\n');
  return i >= 0 ? s.slice(0, i) : s;
}

function BashCardBase({ entry }: BashCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const onToggle = useCallback(() => setExpanded((v) => !v), []);

  const input = entry.input as BashInput;
  const command = typeof input.command === 'string' ? input.command : '';
  const description = typeof input.description === 'string' ? input.description : '';

  const structured = entry.structured;
  const hasStructured = structured != null;
  const stdout = structured?.stdout ?? '';
  const stderr = structured?.stderr ?? '';
  const exitCode = structured?.exitCode;
  const interrupted = structured?.interrupted === true;

  const header = useMemo<ToolCardHeaderData>(() => {
    const identity = description.length > 0 ? description : truncate(command, 40);
    const chips: ToolCardChip[] = [];
    if (entry.state !== 'running' && hasStructured) {
      if (interrupted) {
        chips.push({ text: 'interrupted', tone: 'warn' });
      } else if (typeof exitCode === 'number') {
        if (exitCode === 0) chips.push({ text: 'exit 0', tone: 'good' });
        else chips.push({ text: `exit ${exitCode}`, tone: 'bad' });
      }
    }
    let errorSummary: string | undefined;
    if (entry.state === 'error') {
      const src = stderr.length > 0 ? stderr : resultToText(entry.result);
      const line = firstLine(src).trim();
      if (line.length > 0) errorSummary = truncate(line, 80);
    }
    return { identity: identity.length > 0 ? identity : undefined, chips, errorSummary };
  }, [
    description,
    command,
    entry.state,
    entry.result,
    hasStructured,
    interrupted,
    exitCode,
    stderr,
  ]);

  const fallbackText = !stdout && !stderr ? resultToText(entry.result) : '';
  const showFallback = fallbackText.length > 0;
  const showEmpty = !stdout && !stderr && !showFallback;

  return (
    <ToolCard
      toolName={entry.toolName}
      state={entry.state}
      header={header}
      expanded={expanded}
      onToggleExpand={onToggle}
    >
      <View>
        <Text style={styles.label}>command</Text>
        {description.length > 0 && (
          <Text style={styles.description} selectable>
            {description}
          </Text>
        )}
        <Text style={styles.commandText} selectable>
          {command}
        </Text>

        {stdout.length > 0 && (
          <>
            <Text style={[styles.label, styles.labelSpaced]}>stdout</Text>
            <ScrollView style={styles.scroll} nestedScrollEnabled>
              <Text style={styles.stdoutText} selectable>
                {stdout}
              </Text>
            </ScrollView>
          </>
        )}

        {stderr.length > 0 && (
          <>
            <Text style={[styles.label, styles.labelSpaced]}>stderr</Text>
            <ScrollView style={styles.scroll} nestedScrollEnabled>
              <Text style={styles.stderrText} selectable>
                {stderr}
              </Text>
            </ScrollView>
          </>
        )}

        {showFallback && (
          <>
            <Text style={[styles.label, styles.labelSpaced]}>output</Text>
            <ScrollView style={styles.scroll} nestedScrollEnabled>
              <Text style={styles.stdoutText} selectable>
                {fallbackText}
              </Text>
            </ScrollView>
          </>
        )}

        {showEmpty && entry.state !== 'running' && (
          <Text style={[styles.empty, styles.labelSpaced]}>(no output)</Text>
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
  description: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontStyle: 'italic',
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  commandText: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body,
    color: Colors.textPrimary,
    flexWrap: 'wrap',
  },
  scroll: {
    maxHeight: 400,
  },
  stdoutText: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body - 2,
    color: Colors.textPrimary,
  },
  stderrText: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body - 2,
    color: Colors.accentRed,
  },
  empty: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontStyle: 'italic',
    color: Colors.textSecondary,
  },
});

export const BashCard = memo(BashCardBase);
