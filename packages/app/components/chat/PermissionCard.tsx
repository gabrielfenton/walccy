// ──────────────────────────────────────────────
// PermissionCard — interactive allow/deny card for permission_request
// ──────────────────────────────────────────────

import React, { memo, useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ChatEntryPermissionRequest } from '../../stores/messages.store';
import { useMessagesStore } from '../../stores/messages.store';
import { wsClient } from '../../services/ws-client';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize } from '../../constants/typography';

interface PermissionCardProps {
  entry: ChatEntryPermissionRequest;
  sessionId: string;
}

function PermissionCardBase({ entry, sessionId }: PermissionCardProps): React.ReactElement {
  const resolved = entry.resolved;

  const onPressAllow = useCallback(() => {
    useMessagesStore.getState().markPermissionResolved(sessionId, entry.requestId, 'allowed');
    wsClient.resolvePermission(sessionId, entry.requestId, 'allow');
  }, [sessionId, entry.requestId]);

  const onPressDeny = useCallback(() => {
    useMessagesStore.getState().markPermissionResolved(sessionId, entry.requestId, 'denied');
    wsClient.resolvePermission(sessionId, entry.requestId, 'deny');
  }, [sessionId, entry.requestId]);

  const inputJson = useMemo(() => {
    try {
      return JSON.stringify(entry.input, null, 2);
    } catch {
      return String(entry.input);
    }
  }, [entry.input]);

  return (
    <View
      style={[
        styles.card,
        { borderLeftColor: resolved ? Colors.border : Colors.accentAmber },
        resolved ? styles.resolved : null,
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={styles.headerGlyph}>?  </Text>
        <Text style={styles.toolName}>{entry.toolName}</Text>
        <Text style={styles.headerCaption}>  wants to run</Text>
      </View>
      {entry.title ? <Text style={styles.title}>{entry.title}</Text> : null}
      {entry.description ? <Text style={styles.description}>{entry.description}</Text> : null}

      <View style={styles.inputBlock}>
        <ScrollView style={styles.inputScroll} nestedScrollEnabled>
          <Text style={styles.inputText}>{inputJson}</Text>
        </ScrollView>
      </View>

      {resolved ? (
        <View style={styles.statusRow}>
          <Text
            style={[
              styles.statusText,
              { color: resolved === 'allowed' ? Colors.accentGreen : Colors.accentRed },
            ]}
          >
            {resolved === 'allowed' ? 'Allowed' : 'Denied'}
          </Text>
        </View>
      ) : (
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.button, styles.denyButton]}
            onPress={onPressDeny}
            disabled={!!resolved}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Deny tool"
          >
            <Text style={styles.denyText}>Deny</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.allowButton]}
            onPress={onPressAllow}
            disabled={!!resolved}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Allow tool"
          >
            <Text style={styles.allowText}>Allow</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export const PermissionCard = memo(PermissionCardBase);

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginVertical: 4,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: Colors.accentAmber,
    backgroundColor: Colors.surface,
    padding: 12,
  },
  resolved: {
    opacity: 0.5,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
  },
  headerGlyph: {
    color: Colors.accentAmber,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body,
    fontWeight: '700',
  },
  toolName: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body,
    fontWeight: '600',
  },
  headerCaption: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
  },
  title: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    marginTop: 6,
  },
  description: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    marginTop: 4,
  },
  inputBlock: {
    marginTop: 10,
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  inputScroll: {
    maxHeight: 160,
  },
  inputText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body - 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  button: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  denyButton: {
    backgroundColor: Colors.surfaceHigh,
    borderColor: Colors.accentRed + '66',
  },
  denyText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: '600',
  },
  allowButton: {
    backgroundColor: Colors.accentGreen,
    borderColor: Colors.accentGreen,
  },
  allowText: {
    color: '#0D0D0D',
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: '700',
  },
  statusRow: {
    marginTop: 12,
    alignItems: 'center',
  },
  statusText: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: '700',
  },
});
