// ──────────────────────────────────────────────
// UserBubble — right-aligned chat bubble for user messages
// ──────────────────────────────────────────────

import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { UserContentBlock } from '@walccy/protocol';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize } from '../../constants/typography';

interface UserBubbleProps {
  content: UserContentBlock[];
}

function flattenText(content: UserContentBlock[]): string {
  const parts: string[] = [];
  for (const b of content) {
    if (b.type === 'text') parts.push(b.text);
    else if (b.type === 'image') parts.push('[image]');
  }
  return parts.join('\n').trim();
}

function UserBubbleBase({ content }: UserBubbleProps): React.ReactElement {
  const text = flattenText(content);
  return (
    <View style={styles.row}>
      <View style={styles.bubble}>
        <Text style={styles.text} selectable>
          {text || ' '}
        </Text>
      </View>
    </View>
  );
}

export const UserBubble = memo(UserBubbleBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  bubble: {
    maxWidth: '85%',
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  text: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    lineHeight: FontSize.body * 1.4,
  },
});
