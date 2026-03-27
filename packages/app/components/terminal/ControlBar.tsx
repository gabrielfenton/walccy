// ──────────────────────────────────────────────
// Walccy — ControlBar
// Quick-access key row above the keyboard.
// ──────────────────────────────────────────────

import React, { useRef, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { wsClient } from '../../services/ws-client';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize } from '../../constants/typography';

// ──────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────

interface ControlBarProps {
  sessionId: string;
  onOpenPromptLibrary: () => void;
  onOpenClipboard: () => void;
}

// ──────────────────────────────────────────────
// Ctrl combo map
// Maps printable chars to their Ctrl-key byte.
// ──────────────────────────────────────────────

const CTRL_COMBOS: Record<string, string> = {
  a: '\x01', b: '\x02', c: '\x03', d: '\x04', e: '\x05',
  f: '\x06', g: '\x07', h: '\x08', i: '\x09', j: '\x0a',
  k: '\x0b', l: '\x0c', m: '\x0d', n: '\x0e', o: '\x0f',
  p: '\x10', q: '\x11', r: '\x12', s: '\x13', t: '\x14',
  u: '\x15', v: '\x16', w: '\x17', x: '\x18', y: '\x19',
  z: '\x1a',
};

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type KeyDef =
  | { kind: 'ctrl' }
  | { kind: 'key'; label: string; data: string; repeatable?: boolean }
  | { kind: 'action'; label: string; onPress: () => void };

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

export function ControlBar({
  sessionId,
  onOpenPromptLibrary,
  onOpenClipboard,
}: ControlBarProps): React.ReactElement {
  const [ctrlActive, setCtrlActive] = useState(false);
  const repeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sendKey = useCallback(
    (data: string) => {
      wsClient.sendInput(sessionId, data);
    },
    [sessionId]
  );

  const handleKeyPress = useCallback(
    (data: string) => {
      if (ctrlActive) {
        // Try to map single-char keys to Ctrl combos
        const charKey = data.toLowerCase();
        const combo = CTRL_COMBOS[charKey];
        if (combo) {
          sendKey(combo);
        } else {
          // For Esc, Tab, arrows — just send as-is
          sendKey(data);
        }
        setCtrlActive(false);
      } else {
        sendKey(data);
      }
    },
    [ctrlActive, sendKey]
  );

  const startRepeat = useCallback(
    (data: string) => {
      if (repeatIntervalRef.current) return;
      repeatIntervalRef.current = setInterval(() => {
        wsClient.sendInput(sessionId, data);
      }, 100);
    },
    [sessionId]
  );

  const stopRepeat = useCallback(() => {
    if (repeatIntervalRef.current) {
      clearInterval(repeatIntervalRef.current);
      repeatIntervalRef.current = null;
    }
  }, []);

  const keys: KeyDef[] = [
    { kind: 'ctrl' },
    { kind: 'key', label: 'Esc', data: '\x1b' },
    { kind: 'key', label: 'Tab', data: '\t' },
    { kind: 'key', label: '↑', data: '\x1b[A', repeatable: true },
    { kind: 'key', label: '↓', data: '\x1b[B', repeatable: true },
    { kind: 'key', label: '←', data: '\x1b[D', repeatable: true },
    { kind: 'key', label: '→', data: '\x1b[C', repeatable: true },
    { kind: 'action', label: '📚', onPress: onOpenPromptLibrary },
    { kind: 'action', label: '📋', onPress: onOpenClipboard },
  ];

  return (
    <View style={styles.bar}>
      {keys.map((key, index) => {
        const isFirst = index === 0;
        const isLast = index === keys.length - 1;

        if (key.kind === 'ctrl') {
          return (
            <TouchableOpacity
              key="ctrl"
              style={[
                styles.button,
                !isFirst && styles.buttonBorder,
                isLast && styles.buttonLast,
              ]}
              onPress={() => setCtrlActive((prev) => !prev)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Ctrl modifier key"
            >
              <Text
                style={[
                  styles.buttonText,
                  ctrlActive && styles.buttonTextActive,
                ]}
              >
                Ctrl
              </Text>
            </TouchableOpacity>
          );
        }

        if (key.kind === 'action') {
          return (
            <TouchableOpacity
              key={key.label}
              style={[
                styles.button,
                !isFirst && styles.buttonBorder,
                isLast && styles.buttonLast,
              ]}
              onPress={key.onPress}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={key.label}
            >
              <Text style={styles.buttonText}>{key.label}</Text>
            </TouchableOpacity>
          );
        }

        // kind === 'key'
        return (
          <TouchableOpacity
            key={key.label}
            style={[
              styles.button,
              !isFirst && styles.buttonBorder,
              isLast && styles.buttonLast,
            ]}
            onPress={() => handleKeyPress(key.data)}
            onLongPress={key.repeatable ? () => startRepeat(key.data) : undefined}
            onPressOut={key.repeatable ? stopRepeat : undefined}
            delayLongPress={300}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={key.label}
          >
            <Text style={styles.buttonText}>{key.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  bar: {
    height: 44,
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  button: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonBorder: {
    borderLeftWidth: 1,
    borderLeftColor: Colors.border,
  },
  buttonLast: {
    // no special treatment needed for last button
  },
  buttonText: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.terminal,
  },
  buttonTextActive: {
    color: Colors.accent,
  },
});
