// ──────────────────────────────────────────────
// Composer — chat-style multi-line input + send/stop button
// ──────────────────────────────────────────────
//
// Replaces the v1 InputBar + ControlBar pair. F6 ships text-only send
// and a stop button that interrupts the in-flight turn. The `+` menu
// (file/image picker), plan-mode toggle and permission-mode chip land
// in F21/F22/F23.

import React, { useCallback, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSessionsStore } from '../../stores/sessions.store';
import { useShallow } from 'zustand/react/shallow';
import { wsClient } from '../../services/ws-client';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize } from '../../constants/typography';

interface ComposerProps {
  sessionId: string;
}

export function Composer({ sessionId }: ComposerProps): React.ReactElement {
  const [text, setText] = useState('');

  // The session is "streaming" while it is generating a turn — drive the
  // stop/send swap from the daemon-reported status.
  const { status, waitingForInput } = useSessionsStore(
    useShallow((s) => {
      const session = s.sessions[sessionId];
      return {
        status: session?.status ?? 'idle',
        waitingForInput: session?.waitingForInput ?? false,
      };
    })
  );
  const streaming = status === 'active' && !waitingForInput;
  const canSend = text.trim().length > 0 && !streaming;

  const handleSend = useCallback(() => {
    const body = text.trim();
    if (!body) return;
    wsClient.sendUserText(sessionId, body);
    setText('');
  }, [sessionId, text]);

  const handleStop = useCallback(() => {
    wsClient.interrupt(sessionId);
  }, [sessionId]);

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
        placeholder="Message Claude…"
        placeholderTextColor={Colors.textSecondary}
        multiline
        editable={!streaming}
        returnKeyType="default"
        accessibilityLabel="Message input"
        accessibilityHint="Type a message and tap send"
      />
      {streaming ? (
        <TouchableOpacity
          style={[styles.button, styles.stopButton]}
          onPress={handleStop}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Stop"
        >
          <View style={styles.stopSquare} />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.button, styles.sendButton, !canSend && styles.disabled]}
          onPress={handleSend}
          disabled={!canSend}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Send"
        >
          <Text style={styles.sendGlyph}>↑</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 8,
  },
  containerWaiting: {
    borderTopColor: Colors.accentAmber,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.input,
    lineHeight: FontSize.input * 1.35,
  },
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButton: {
    backgroundColor: Colors.accent,
  },
  stopButton: {
    backgroundColor: Colors.accentRed,
  },
  disabled: {
    opacity: 0.35,
  },
  sendGlyph: {
    color: Colors.textPrimary,
    fontSize: 20,
    fontFamily: FontFamily.ui,
    fontWeight: '700',
    lineHeight: 22,
  },
  stopSquare: {
    width: 12,
    height: 12,
    borderRadius: 2,
    backgroundColor: Colors.textPrimary,
  },
});
