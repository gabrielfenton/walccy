// ──────────────────────────────────────────────
// Walccy — PromptItem
// Single row in the prompt library list.
// ──────────────────────────────────────────────

import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { Prompt } from '../../stores/prompt-library.store';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize } from '../../constants/typography';

// ──────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────

interface PromptItemProps {
  prompt: Prompt;
  onPress: () => void;
  onLongPress: () => void;
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

export function PromptItem({
  prompt,
  onPress,
  onLongPress,
}: PromptItemProps): React.ReactElement {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={prompt.title}
    >
      {/* Pin indicator */}
      {prompt.isPinned ? (
        <Text style={styles.pinIcon}>📌</Text>
      ) : (
        <View style={styles.pinPlaceholder} />
      )}

      {/* Text content */}
      <View style={styles.textContainer}>
        <Text style={styles.title} numberOfLines={1}>
          {prompt.title}
        </Text>
        <Text style={styles.preview} numberOfLines={1} ellipsizeMode="tail">
          {prompt.content}
        </Text>
      </View>

      {/* Use count badge */}
      {prompt.useCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{prompt.useCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },

  pinIcon: {
    fontSize: 14,
    marginRight: 10,
    color: Colors.accentAmber,
  },

  pinPlaceholder: {
    width: 24,
    marginRight: 10,
  },

  textContainer: {
    flex: 1,
    gap: 2,
  },

  title: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: 14,
    fontWeight: '600',
  },

  preview: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: 12,
  },

  badge: {
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginLeft: 8,
    minWidth: 22,
    alignItems: 'center',
  },

  badgeText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: 11,
  },
});
