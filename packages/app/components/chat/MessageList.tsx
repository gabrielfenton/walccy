// ──────────────────────────────────────────────
// MessageList — chat scrollable area
// ──────────────────────────────────────────────
//
// Drop-in replacement for TerminalOutput. Consumes the per-session
// ChatEntry list from messages.store and renders the appropriate
// component per entry. F5 ships UserBubble + AssistantMessage; F7 adds
// ThinkingCard; F9..F20 add tool cards via the registry pattern. Unknown
// entry kinds fall through to a tiny info row so we don't lose data.

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { FlashList, FlashListRef, ListRenderItemInfo } from '@shopify/flash-list';
import { useMessagesStore } from '../../stores/messages.store';
import type { ChatEntry } from '../../stores/messages.store';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize } from '../../constants/typography';
import { UserBubble } from './UserBubble';
import { AssistantMessage } from './AssistantMessage';
import { ThinkingCard } from './ThinkingCard';
import { renderToolCard } from './tools/tool-card-registry';

interface MessageListProps {
  sessionId: string;
}

function renderEntry({ item }: ListRenderItemInfo<ChatEntry>): React.ReactElement {
  switch (item.kind) {
    case 'user':
      return <UserBubble content={item.content} />;
    case 'assistant':
      return <AssistantMessage text={item.text} streaming={item.streaming} />;
    case 'thinking':
      return (
        <ThinkingCard
          text={item.text}
          streaming={item.streaming}
          timestamp={item.timestamp}
        />
      );
    case 'tool':
      return renderToolCard(item);
    case 'permission_request':
      return <PermissionPlaceholder toolName={item.toolName} />;
    case 'turn_summary':
      return <TurnPlaceholder cost={item.cost.total} stopReason={item.stopReason} />;
    case 'error':
      return <ErrorPlaceholder code={item.code} message={item.message} />;
    default: {
      // Exhaustiveness guard — TS errors if a new ChatEntry kind is added
      // without a case above.
      const _exhaustive: never = item;
      void _exhaustive;
      return <View />;
    }
  }
}

function keyExtractor(item: ChatEntry): string {
  return item.id;
}

function MessageListBase({ sessionId }: MessageListProps): React.ReactElement {
  const buffer = useMessagesStore((s) => s.buffers[sessionId]);
  const entries = buffer?.entries ?? [];

  const listRef = useRef<FlashListRef<ChatEntry>>(null);
  const [atBottom, setAtBottom] = useState(true);

  const lengthRef = useRef(entries.length);
  useEffect(() => {
    if (entries.length > lengthRef.current && atBottom) {
      listRef.current?.scrollToEnd({ animated: false });
    }
    lengthRef.current = entries.length;
  }, [entries.length, atBottom]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
      setAtBottom(
        contentOffset.y + layoutMeasurement.height >= contentSize.height - 60
      );
    },
    []
  );

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
    setAtBottom(true);
  }, []);

  return (
    <View style={styles.container}>
      <FlashList
        ref={listRef}
        data={entries}
        renderItem={renderEntry}
        keyExtractor={keyExtractor}
        estimatedItemSize={80}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      />
      {!atBottom && (
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

export const MessageList = memo(MessageListBase);

// ──────────────────────────────────────────────
// F5 placeholders for non-text entries
// ──────────────────────────────────────────────
//
// These render minimally legible info-rows for entry kinds whose full
// card lands in later features (F7 ThinkingCard, F9..F20 tool cards, F19
// QuestionCard, F20 PlanCard, F28 rate-limit banner). Keeps data visible
// during the interim ship without re-writing MessageList each time.

function PermissionPlaceholder({ toolName }: { toolName: string }): React.ReactElement {
  return (
    <View style={[styles.info, styles.permission]}>
      <Text style={[styles.infoLabel, { color: Colors.accentAmber }]}>
        ? Awaiting decision · {toolName}
      </Text>
    </View>
  );
}

function TurnPlaceholder({
  cost,
  stopReason,
}: {
  cost: number;
  stopReason: string | null;
}): React.ReactElement {
  return (
    <View style={styles.info}>
      <Text style={styles.infoText}>
        Turn · ${cost.toFixed(4)} · {stopReason ?? 'unknown'}
      </Text>
    </View>
  );
}

function ErrorPlaceholder({
  code,
  message,
}: {
  code: string;
  message: string;
}): React.ReactElement {
  return (
    <View style={[styles.info, styles.errorRow]}>
      <Text style={[styles.infoLabel, { color: Colors.accentRed }]}>
        Error · {code}
      </Text>
      <Text style={styles.infoText}>{message}</Text>
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
  info: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginVertical: 2,
  },
  infoLabel: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: '600',
  },
  infoText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    marginTop: 2,
  },
  permission: {
    backgroundColor: Colors.surface,
    borderLeftWidth: 3,
    borderLeftColor: Colors.accentAmber,
    paddingLeft: 12,
  },
  errorRow: {
    backgroundColor: Colors.surface,
    borderLeftWidth: 3,
    borderLeftColor: Colors.accentRed,
    paddingLeft: 12,
  },
  fab: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
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
