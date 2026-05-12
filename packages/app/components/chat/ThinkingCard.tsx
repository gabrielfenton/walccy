// ──────────────────────────────────────────────
// ThinkingCard — extended thinking entry, collapsible
// ──────────────────────────────────────────────

import React, { memo, useEffect, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize } from '../../constants/typography';

interface ThinkingCardProps {
  text: string;
  streaming: boolean;
  timestamp: number;
}

function ThinkingCardBase({
  text,
  streaming,
  timestamp,
}: ThinkingCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(true);
  const durationRef = useRef<number | null>(null);
  const prevStreamingRef = useRef(streaming);

  useEffect(() => {
    if (prevStreamingRef.current && !streaming && durationRef.current === null) {
      durationRef.current = Math.round(((Date.now() - timestamp) / 1000) * 10) / 10;
      setExpanded(false);
    }
    prevStreamingRef.current = streaming;
  }, [streaming, timestamp]);

  const showExpanded = streaming || expanded;
  const headerLabel = streaming
    ? 'Thinking…'
    : durationRef.current !== null
      ? `🧠 Thought for ${durationRef.current.toFixed(1)}s`
      : '🧠 Thought for —';

  const Header: React.ReactElement = (
    <View style={styles.header}>
      <Text style={styles.headerText}>{headerLabel}</Text>
      {!streaming && (
        <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
      )}
    </View>
  );

  return (
    <View style={styles.card}>
      {streaming ? (
        Header
      ) : (
        <TouchableOpacity
          onPress={() => setExpanded((v) => !v)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Collapse thinking' : 'Expand thinking'}
          style={styles.headerHit}
        >
          {Header}
        </TouchableOpacity>
      )}
      {showExpanded && text.length > 0 && (
        <ScrollView style={styles.bodyScroll} nestedScrollEnabled>
          <Text style={styles.bodyText}>{text}</Text>
        </ScrollView>
      )}
    </View>
  );
}

export const ThinkingCard = memo(ThinkingCardBase);

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginVertical: 4,
    borderLeftWidth: 3,
    borderLeftColor: Colors.accent,
    backgroundColor: '#141414',
    borderRadius: 6,
    overflow: 'hidden',
  },
  headerHit: {
    minHeight: 44,
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
  },
  headerText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: '600',
  },
  chevron: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    marginLeft: 8,
  },
  bodyScroll: {
    maxHeight: 280,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  bodyText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body - 1,
    lineHeight: (FontSize.body - 1) * 1.5,
  },
});
