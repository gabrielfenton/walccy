// ──────────────────────────────────────────────
// MessageList — chat scrollable area
// ──────────────────────────────────────────────
//
// Drop-in replacement for TerminalOutput. Consumes the per-session
// ChatEntry list from messages.store and renders the appropriate
// component per entry. F5 ships UserBubble + AssistantMessage; F7 adds
// ThinkingCard; F9..F20 add tool cards via the registry pattern. Unknown
// entry kinds fall through to a tiny info row so we don't lose data.

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { ChatEntry, ChatEntryTool } from '../../stores/messages.store';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize } from '../../constants/typography';
import { UserBubble } from './UserBubble';
import { AssistantMessage } from './AssistantMessage';
import { ThinkingCard } from './ThinkingCard';
import { PermissionCard } from './PermissionCard';
import { renderToolCard } from './tools/tool-card-registry';

interface MessageListProps {
  sessionId: string;
}

function renderEntry(
  { item }: ListRenderItemInfo<ChatEntry>,
  childMap: Map<string, ChatEntryTool[]>,
  sessionId: string,
): React.ReactElement {
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
    case 'tool': {
      const kids = childMap.get(item.toolUseId);
      if (kids && kids.length > 0) {
        return <AgentChildrenWrapper parent={item} children={kids} sessionId={sessionId} />;
      }
      return renderToolCard(item, sessionId);
    }
    case 'permission_request':
      return <PermissionCard entry={item} sessionId={sessionId} />;
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

// AgentChildrenWrapper — visual grouping for sub-agent tool calls.
// MessageList owns this concern so the tool-card registry signature stays
// `(entry) => ReactElement` for the parallel F9 work. When F16's AgentCard
// lands, it just renders normally and children fall into place below.
function AgentChildrenWrapper({
  parent,
  children,
  sessionId,
}: {
  parent: ChatEntryTool;
  children: ChatEntryTool[];
  sessionId: string;
}): React.ReactElement {
  return (
    <View>
      {renderToolCard(parent, sessionId)}
      <View style={{ marginLeft: 18 }}>
        {children.map((c) => (
          <View key={c.id}>{renderToolCard(c, sessionId)}</View>
        ))}
      </View>
    </View>
  );
}

function keyExtractor(item: ChatEntry): string {
  return item.id;
}

function MessageListBase({ sessionId }: MessageListProps): React.ReactElement {
  const buffer = useMessagesStore((s) => s.buffers[sessionId]);
  const entries = buffer?.entries ?? [];

  // Pre-pass: group sub-agent tool calls under their parent. A tool entry
  // whose `parentToolUseId` matches another tool entry's `toolUseId` in the
  // same buffer is treated as a child and removed from the top-level list.
  // Orphan children (parent not found in buffer) fall through to top level
  // so we never silently drop data.
  const { visibleEntries, childMap } = useMemo(() => {
    const parentIds = new Set<string>();
    for (const e of entries) {
      if (e.kind === 'tool') parentIds.add(e.toolUseId);
    }
    const map = new Map<string, ChatEntryTool[]>();
    const visible: ChatEntry[] = [];
    for (const e of entries) {
      if (
        e.kind === 'tool' &&
        e.parentToolUseId !== null &&
        parentIds.has(e.parentToolUseId)
      ) {
        const arr = map.get(e.parentToolUseId);
        if (arr) arr.push(e);
        else map.set(e.parentToolUseId, [e]);
        continue;
      }
      visible.push(e);
    }
    return { visibleEntries: visible, childMap: map };
  }, [entries]);

  const listRef = useRef<FlashListRef<ChatEntry>>(null);
  const [atBottom, setAtBottom] = useState(true);

  const lengthRef = useRef(visibleEntries.length);
  useEffect(() => {
    if (visibleEntries.length > lengthRef.current && atBottom) {
      listRef.current?.scrollToEnd({ animated: false });
    }
    lengthRef.current = visibleEntries.length;
  }, [visibleEntries.length, atBottom]);

  const renderItem = useCallback(
    (info: ListRenderItemInfo<ChatEntry>) => renderEntry(info, childMap, sessionId),
    [childMap, sessionId],
  );

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
        data={visibleEntries}
        renderItem={renderItem}
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

function TurnPlaceholder({
  cost,
  stopReason,
}: {
  cost: number;
  stopReason: string | null;
}): React.ReactElement {
  // The SDK reports an interrupted turn with no/falsy stopReason or one of
  // a small family of values. Surface as a distinct visual so a stopped
  // turn doesn't read identically to "end_turn".
  const interrupted =
    stopReason == null ||
    stopReason === 'interrupted' ||
    stopReason === 'pause_turn' ||
    stopReason === 'user_interrupted' ||
    stopReason === 'cancelled';
  return (
    <View style={interrupted ? [styles.info, styles.turnInterrupted] : styles.info}>
      <Text style={interrupted ? [styles.infoText, styles.turnInterruptedText] : styles.infoText}>
        Turn · ${cost.toFixed(4)} · {interrupted ? 'interrupted' : stopReason}
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
  turnInterrupted: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.accentAmber,
    paddingLeft: 12,
  },
  turnInterruptedText: {
    color: Colors.accentAmber,
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
