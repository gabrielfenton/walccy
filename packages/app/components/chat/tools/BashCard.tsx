import React, { memo, useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChatEntryTool } from '../../../stores/messages.store';
import { Colors } from '../../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../../constants/typography';
import { ToolCard } from './ToolCard';

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

  let header: React.ReactNode = null;
  if (entry.state !== 'running' && hasStructured) {
    if (interrupted) {
      header = <Text style={[styles.chip, { color: Colors.accentAmber }]}>interrupted</Text>;
    } else if (typeof exitCode === 'number') {
      const ok = exitCode === 0;
      header = (
        <Text style={[styles.chip, { color: ok ? Colors.accentGreen : Colors.accentRed }]}>
          {`exit ${exitCode}`}
        </Text>
      );
    }
  }

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
    maxHeight: 240,
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
  chip: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semiBold,
  },
});

export const BashCard = memo(BashCardBase);
