// ──────────────────────────────────────────────
// Walccy — TabBar
// Horizontal scrollable tab bar for sessions.
// Auto-scrolls to the active tab when it changes.
// ──────────────────────────────────────────────

import React, { useEffect, useRef } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../constants/typography';
import { TabItem } from './TabItem';
import type { Session } from '../../types';

// ── Types ─────────────────────────────────────

export interface TabBarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onCloseSession: (id: string) => void;
  onAddSession: () => void;
}

// ── Component ─────────────────────────────────

export const TabBar: React.FC<TabBarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onCloseSession,
  onAddSession,
}) => {
  const scrollRef = useRef<ScrollView>(null);
  // Map of sessionId → x offset within the ScrollView
  const offsetMapRef = useRef<Record<string, number>>({});

  // Auto-scroll to active tab when activeSessionId changes
  useEffect(() => {
    if (!activeSessionId) return;
    const x = offsetMapRef.current[activeSessionId];
    if (x != null) {
      scrollRef.current?.scrollTo({ x, animated: true });
    }
  }, [activeSessionId]);

  function handleLongPress(session: Session): void {
    Alert.alert(
      session.name,
      'Remove this session from the tab bar?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => onCloseSession(session.id),
        },
      ]
    );
  }

  function handleItemLayout(
    sessionId: string,
    event: { nativeEvent: { layout: { x: number } } }
  ): void {
    offsetMapRef.current[sessionId] = event.nativeEvent.layout.x;
  }

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {sessions.map((session) => (
          <View
            key={session.id}
            onLayout={(e) => handleItemLayout(session.id, e)}
          >
            <TabItem
              session={session}
              isActive={session.id === activeSessionId}
              onPress={() => onSelectSession(session.id)}
              onLongPress={() => handleLongPress(session)}
            />
          </View>
        ))}

        {/* Add session button */}
        <TouchableOpacity
          style={styles.addButton}
          onPress={onAddSession}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Add session"
        >
          <Text style={styles.addButtonText}>+</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

// ── Styles ────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    height: 52,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    justifyContent: 'center',
  },

  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },

  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },

  addButtonText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.heading,
    fontWeight: FontWeight.regular,
    lineHeight: 20,
  },
});
