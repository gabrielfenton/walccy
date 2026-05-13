import React, { memo, useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChatEntryTool } from '../../../stores/messages.store';
import { Colors } from '../../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../../constants/typography';
import { ToolCard, type ToolCardChip, type ToolCardHeaderData } from './ToolCard';
import { firstLine, resultToText, truncate } from './cardFormat';
import { FallbackCard } from './FallbackCard';

interface McpToolCardProps {
  entry: ChatEntryTool;
  sessionId: string;
}

function parseMcpToolName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith('mcp__')) return null;
  const rest = name.slice(5);
  const idx = rest.indexOf('__');
  if (idx < 0) return null;
  return { server: rest.slice(0, idx), tool: rest.slice(idx + 2) };
}

// Strip Unicode Format (Cf) chars — RTL marks, zero-width joiners,
// BOMs, etc. Prevents spoofing attempts via bidi overrides.
function safeServerName(raw: string): string {
  return raw.replace(/\p{Cf}/gu, '');
}

function McpToolCardBase({ entry, sessionId }: McpToolCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const onToggle = useCallback(() => setExpanded((v) => !v), []);

  const parsed = useMemo(() => parseMcpToolName(entry.toolName), [entry.toolName]);

  const resultText = useMemo(() => resultToText(entry.result), [entry.result]);
  const inputJson = useMemo(() => JSON.stringify(entry.input, null, 2), [entry.input]);

  const header = useMemo<ToolCardHeaderData>(() => {
    if (parsed == null) return {};
    const chips: ToolCardChip[] = [];
    let errorSummary: string | undefined;
    if (entry.state === 'error') {
      const line = firstLine(resultText).trim();
      if (line.length > 0) errorSummary = truncate(line, 80);
    } else {
      chips.push({ text: 'MCP', tone: 'neutral' });
      chips.push({ text: truncate(safeServerName(parsed.server), 32), tone: 'accent' });
    }
    return {
      chips,
      errorSummary,
    };
  }, [parsed, entry.state, resultText]);

  if (parsed == null) {
    return <FallbackCard entry={entry} sessionId={sessionId} />;
  }

  const resultEmpty = resultText.length === 0;

  return (
    <ToolCard
      toolName={truncate(safeServerName(parsed.tool), 32)}
      state={entry.state}
      header={header}
      expanded={expanded}
      onToggleExpand={onToggle}
    >
      <View>
        <Text style={styles.label}>server</Text>
        <Text style={styles.mono} selectable>
          {truncate(safeServerName(parsed.server), 64)}
        </Text>

        <Text style={[styles.label, styles.labelSpaced]}>tool</Text>
        <Text style={styles.mono} selectable>
          {truncate(safeServerName(parsed.tool), 64)}
        </Text>

        <Text style={[styles.label, styles.labelSpaced]}>input</Text>
        <ScrollView style={styles.inputScroll} nestedScrollEnabled>
          <Text style={styles.inputText} selectable>
            {inputJson}
          </Text>
        </ScrollView>

        <Text style={[styles.label, styles.labelSpaced]}>result</Text>
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
  inputScroll: {
    maxHeight: 320,
  },
  inputText: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body - 2,
    color: Colors.textSecondary,
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

export const McpToolCard = memo(McpToolCardBase);
