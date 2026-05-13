// ──────────────────────────────────────────────
// SlashCommandStrip — quick-action buttons for common slash commands
// ──────────────────────────────────────────────
//
// Sits just above the Composer. Each button sends a single user message
// containing the literal slash command. Per the F1 spike (EXP-5), the
// agent loop honours `/init`, `/review`, and `/security-review` when fed
// as user text in stream-json mode — they kick off the corresponding
// built-in routine. Disabled while the session is waiting on input or
// streaming output to avoid double-queueing turns.

import React, { useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { wsClient } from '../../services/ws-client';
import { useSessionsStore } from '../../stores/sessions.store';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../constants/typography';

interface SlashAction {
  command: string;
  label: string;
}

const ACTIONS: readonly SlashAction[] = [
  { command: '/init',            label: '/init'     },
  { command: '/review',          label: '/review'   },
  { command: '/security-review', label: '/sec-rev'  },
];

interface SlashCommandStripProps {
  sessionId: string;
}

export function SlashCommandStrip({
  sessionId,
}: SlashCommandStripProps): React.ReactElement | null {
  const session = useSessionsStore(
    useShallow((s) => {
      const sess = s.sessions[sessionId];
      if (!sess) return null;
      return { status: sess.status, waitingForInput: sess.waitingForInput };
    }),
  );

  const onPress = useCallback(
    (cmd: string) => {
      wsClient.sendUserText(sessionId, cmd);
    },
    [sessionId],
  );

  if (!session) return null;
  const disabled =
    session.status === 'ended' ||
    session.waitingForInput;

  return (
    <View style={styles.row}>
      {ACTIONS.map((a) => (
        <TouchableOpacity
          key={a.command}
          style={[styles.button, disabled && styles.buttonDisabled]}
          onPress={() => onPress(a.command)}
          activeOpacity={0.7}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`Run ${a.command}`}
          accessibilityState={{ disabled }}
        >
          <Text style={[styles.text, disabled && styles.textDisabled]}>
            {a.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  button: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceHigh,
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  text: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.medium,
  },
  textDisabled: {
    color: Colors.textSecondary,
  },
});
