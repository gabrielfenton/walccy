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
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSessionsStore } from '../../stores/sessions.store';
import { useShallow } from 'zustand/react/shallow';
import { wsClient } from '../../services/ws-client';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize } from '../../constants/typography';
import type { PermissionMode } from '@walccy/protocol';

const MODE_OPTIONS: ReadonlyArray<{ mode: PermissionMode; label: string }> = [
  { mode: 'default', label: 'Default' },
  { mode: 'acceptEdits', label: 'Auto-edit' },
  { mode: 'plan', label: 'Plan' },
  { mode: 'bypassPermissions', label: 'Bypass' },
];

interface ComposerProps {
  sessionId: string;
}

export function Composer({ sessionId }: ComposerProps): React.ReactElement {
  const [text, setText] = useState('');
  const insets = useSafeAreaInsets();

  // The session is "streaming" while it is generating a turn — drive the
  // stop/send swap from the daemon-reported status.
  const { status, waitingForInput, permissionMode } = useSessionsStore(
    useShallow((s) => {
      const session = s.sessions[sessionId];
      return {
        status: session?.status ?? 'idle',
        waitingForInput: session?.waitingForInput ?? false,
        permissionMode: session?.permissionMode,
      };
    })
  );
  const activeMode: PermissionMode = permissionMode ?? 'default';
  const streaming = status === 'active' && !waitingForInput;
  const canSend = text.trim().length > 0 && !streaming;
  const bypassActive = activeMode === 'bypassPermissions';
  const autoEditActive = activeMode === 'acceptEdits';

  const handleSend = useCallback(() => {
    const body = text.trim();
    if (!body) return;
    wsClient.sendUserText(sessionId, body);
    setText('');
  }, [sessionId, text]);

  const handleStop = useCallback(() => {
    wsClient.interrupt(sessionId);
  }, [sessionId]);

  const handleModePress = useCallback(
    (mode: PermissionMode) => {
      if (mode === activeMode) return;
      if (mode === 'bypassPermissions' && activeMode !== 'bypassPermissions') {
        Alert.alert(
          'Enable Bypass mode?',
          'Tool calls will auto-approve without confirmation. You can switch back any time.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Enable', style: 'destructive', onPress: () => wsClient.changePermissionMode(sessionId, mode) },
          ],
        );
        return;
      }
      wsClient.changePermissionMode(sessionId, mode);
    },
    [sessionId, activeMode],
  );

  return (
    <View
      style={[
        styles.container,
        waitingForInput && styles.containerWaiting,
        { paddingBottom: 8 + insets.bottom },
      ]}
    >
      <View style={styles.chipRow}>
        {MODE_OPTIONS.map(({ mode, label }) => {
          const active = mode === activeMode;
          const isBypass = mode === 'bypassPermissions';
          const activeStyle = active
            ? isBypass
              ? styles.chipActiveDanger
              : styles.chipActive
            : styles.chipInactive;
          const activeTextStyle = active
            ? isBypass
              ? styles.chipTextActiveDanger
              : styles.chipTextActive
            : styles.chipTextInactive;
          return (
            <TouchableOpacity
              key={mode}
              style={[styles.chip, activeStyle]}
              onPress={() => handleModePress(mode)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={`Permission mode ${label}`}
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, activeTextStyle]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {bypassActive ? (
        <View style={styles.bypassBanner}>
          <Text style={styles.bypassBannerText}>
            ⚠ Bypass mode — tools auto-approved
          </Text>
        </View>
      ) : autoEditActive ? (
        <View style={styles.autoEditBanner}>
          <Text style={styles.autoEditBannerText}>
            ⚠ Auto-edit — file edits auto-approved
          </Text>
        </View>
      ) : null}
      <View style={styles.inputRow}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: 8,
  },
  inputRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 6,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  chipActiveDanger: {
    backgroundColor: Colors.accentRed + '33',
    borderColor: Colors.accentRed,
  },
  chipInactive: {
    backgroundColor: 'transparent',
    borderColor: Colors.border,
  },
  chipText: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: '600',
  },
  chipTextActive: {
    color: Colors.textPrimary,
  },
  chipTextActiveDanger: {
    color: Colors.accentRed,
  },
  chipTextInactive: {
    color: Colors.textSecondary,
  },
  bypassBanner: {
    marginHorizontal: 4,
    marginBottom: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.accentAmber,
    borderRadius: 4,
    backgroundColor: Colors.accentAmber + '14',
  },
  bypassBannerText: {
    color: Colors.accentAmber,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: '600',
  },
  autoEditBanner: {
    marginHorizontal: 4,
    marginBottom: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.accentAmber + '55',
    borderRadius: 4,
    backgroundColor: Colors.accentAmber + '14',
  },
  autoEditBannerText: {
    color: Colors.accentAmber,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: '600',
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
