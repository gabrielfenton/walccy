import React, { memo, useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChatEntryTool } from '../../../stores/messages.store';
import { Colors } from '../../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../../constants/typography';
import { ToolCard, type ToolCardHeaderData } from './ToolCard';
import { firstLine, resultToText, truncate } from './cardFormat';

interface WebFetchCardProps {
  entry: ChatEntryTool;
  sessionId: string;
}

interface WebFetchInput {
  url?: string;
  prompt?: string;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    const stripped = url.replace(/^[a-zA-Z]+:\/\//, '');
    const slash = stripped.indexOf('/');
    return slash >= 0 ? stripped.slice(0, slash) : stripped;
  }
}

function WebFetchCardBase({ entry }: WebFetchCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const onToggle = useCallback(() => setExpanded((v) => !v), []);

  const input = entry.input as WebFetchInput;
  const url = typeof input.url === 'string' ? input.url : '';
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';

  const text = useMemo(() => resultToText(entry.result), [entry.result]);
  const host = useMemo(() => (url.length > 0 ? hostnameOf(url) : ''), [url]);

  const header = useMemo<ToolCardHeaderData>(() => {
    let errorSummary: string | undefined;
    if (entry.state === 'error') {
      const line = firstLine(resultToText(entry.result)).trim();
      if (line.length > 0) errorSummary = truncate(line, 80);
    }
    return {
      identity: host.length > 0 ? host : undefined,
      chips: [],
      errorSummary,
    };
  }, [host, entry.state, entry.result]);

  return (
    <ToolCard
      toolName={entry.toolName}
      state={entry.state}
      header={header}
      expanded={expanded}
      onToggleExpand={onToggle}
    >
      <View>
        <Text style={styles.label}>url</Text>
        <Text style={styles.mono} selectable>
          {url}
        </Text>

        <Text style={[styles.label, styles.labelSpaced]}>prompt</Text>
        <Text style={styles.promptText} selectable>
          {prompt}
        </Text>

        <Text style={[styles.label, styles.labelSpaced]}>response</Text>
        {text.length === 0 ? (
          <Text style={styles.empty}>(empty)</Text>
        ) : (
          <ScrollView style={styles.scroll} nestedScrollEnabled>
            <Text style={styles.responseText} selectable>
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
  mono: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body,
    color: Colors.textPrimary,
    flexWrap: 'wrap',
  },
  promptText: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontStyle: 'italic',
    color: Colors.textSecondary,
    flexWrap: 'wrap',
  },
  scroll: {
    maxHeight: 400,
  },
  responseText: {
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

export const WebFetchCard = memo(WebFetchCardBase);
