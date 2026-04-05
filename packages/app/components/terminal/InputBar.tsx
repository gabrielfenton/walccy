// ──────────────────────────────────────────────
// Walccy — InputBar
// Prompt input row at the bottom of the terminal.
// ──────────────────────────────────────────────

import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { wsClient } from '../../services/ws-client';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize } from '../../constants/typography';

// ──────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────

interface InputBarProps {
  sessionId: string;
  onFocus?: () => void;
  onBlur?: () => void;
  waitingForInput?: boolean;
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

export function InputBar({
  sessionId,
  onFocus,
  onBlur,
  waitingForInput = false,
}: InputBarProps): React.ReactElement {
  const [text, setText] = useState('');

  const canSend = text.trim().length > 0 && sessionId !== '' && sessionId !== 'no-session';

  const handleSend = useCallback(() => {
    if (!canSend) return;
    wsClient.sendInput(sessionId, text + '\n');
    setText('');
  }, [canSend, sessionId, text]);

  return (
    <View
      style={[
        styles.container,
        waitingForInput && styles.containerWaiting,
      ]}
    >
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Type a prompt or command..."
        placeholderTextColor={Colors.textSecondary}
        multiline
        returnKeyType="default"
        onFocus={onFocus}
        onBlur={onBlur}
        accessibilityLabel="Terminal input"
        accessibilityHint="Type a command and press send"
      />
      <TouchableOpacity
        style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
        onPress={handleSend}
        disabled={!canSend}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Send"
      >
        <Text style={styles.sendButtonText}>▶</Text>
      </TouchableOpacity>
    </View>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 8,
  },
  containerWaiting: {
    borderTopColor: Colors.accentAmber,
  },
  input: {
    flex: 1,
    maxHeight: 72,
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.input,
  },
  sendButton: {
    width: 44,
    height: 44,
    backgroundColor: Colors.accent,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonText: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontFamily: FontFamily.ui,
  },
});
