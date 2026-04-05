// ──────────────────────────────────────────────
// Walccy — TerminalOutput
// Scrollable terminal output using FlashList.
// Performance-critical: avoid re-renders and unnecessary work.
// ──────────────────────────────────────────────

import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { FlashList, ListRenderItemInfo } from '@shopify/flash-list';
import { useOutputStore } from '../../stores/output.store';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize } from '../../constants/typography';
import { TerminalLine } from './TerminalLine';
import type { BufferedLine } from '../../types';

// ──────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────

interface TerminalOutputProps {
  sessionId: string;
  fontSize?: number;
  lineHeight?: number;
  onTextLongPress?: (text: string) => void;
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

export function TerminalOutput({
  sessionId,
  fontSize = 13,
  lineHeight = 1.5,
  onTextLongPress,
}: TerminalOutputProps): React.ReactElement {
  const flashListRef = useRef<FlashList<BufferedLine>>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const buffer = useOutputStore((s) => s.buffers[sessionId]);
  const lines = buffer?.lines ?? [];
  const totalLines = buffer?.totalLines ?? 0;
  const isLoadingHistory = buffer?.isLoadingHistory ?? false;

  // ── Auto-scroll when new lines arrive ─────────

  const lineCount = lines.length;
  const prevLineCountRef = useRef(lineCount);

  useEffect(() => {
    if (lineCount > prevLineCountRef.current && isAtBottom) {
      flashListRef.current?.scrollToEnd({ animated: false });
    }
    prevLineCountRef.current = lineCount;
  }, [lineCount, isAtBottom]);

  // ── Scroll event handler ───────────────────────

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
      const atBottom =
        contentOffset.y + layoutMeasurement.height >= contentSize.height - 50;
      setIsAtBottom(atBottom);
    },
    []
  );

  // ── Item renderer ─────────────────────────────

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<BufferedLine>) => (
      <TouchableOpacity
        activeOpacity={1}
        onLongPress={() => onTextLongPress?.(item.content)}
        delayLongPress={400}
      >
        <TerminalLine line={item} fontSize={fontSize} lineHeight={lineHeight} />
      </TouchableOpacity>
    ),
    [fontSize, lineHeight, onTextLongPress]
  );

  const keyExtractor = useCallback(
    (item: BufferedLine) => item.index.toString(),
    []
  );

  // ── Header component ──────────────────────────

  const ListHeaderComponent = useCallback(() => {
    return (
      <View>
        {isLoadingHistory && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={Colors.textSecondary} />
          </View>
        )}
        {!isLoadingHistory && totalLines > lines.length && (
          <Text style={styles.historyHeader}>
            ↑ {totalLines - lines.length} lines above
          </Text>
        )}
      </View>
    );
  }, [isLoadingHistory, totalLines, lines.length]);

  // ── Scroll to bottom ──────────────────────────

  const scrollToBottom = useCallback(() => {
    flashListRef.current?.scrollToEnd({ animated: true });
    setIsAtBottom(true);
  }, []);

  // ──────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <FlashList
        ref={flashListRef}
        data={lines}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        estimatedItemSize={20}
        ListHeaderComponent={ListHeaderComponent}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
      />

      {/* Scroll-to-bottom FAB */}
      {!isAtBottom && (
        <TouchableOpacity
          style={styles.fab}
          onPress={scrollToBottom}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Scroll to bottom"
        >
          <Text style={styles.fabIcon}>⬇</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  historyHeader: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    textAlign: 'center',
    paddingVertical: 6,
  },
  loadingRow: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  fab: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
  },
  fabIcon: {
    color: Colors.textPrimary,
    fontSize: 18,
  },
});
