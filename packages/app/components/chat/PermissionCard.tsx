// ──────────────────────────────────────────────
// PermissionCard — interactive allow/deny card for permission_request
// ──────────────────────────────────────────────

import React, { memo, useCallback, useMemo, useState } from 'react';
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
  const [expanded, setExpanded] = useState(false);

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

  const hasModelStrings = !!(entry.title || entry.description);

  // ── Resolved + collapsed: compact row ──
  if (resolved && !expanded) {
    const isAllowed = resolved === 'allowed';
    const color = isAllowed ? Colors.accentGreen : Colors.accentRed;
    return (
      <TouchableOpacity
        style={[styles.compactRow, { borderLeftColor: color }]}
        onPress={() => setExpanded(true)}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`${isAllowed ? 'Allowed' : 'Denied'} ${entry.toolName}, tap to expand`}
      >
        <Text style={[styles.compactGlyph, { color }]}>{isAllowed ? '✓' : '✗'}</Text>
        <Text style={styles.compactLabel} numberOfLines={1}>
          {isAllowed ? 'Allowed' : 'Denied'} · {entry.toolName}
        </Text>
        <Text style={styles.compactChevron}>›</Text>
      </TouchableOpacity>
    );
  }

  // ── Pending or resolved+expanded: full card ──
  const borderColor = resolved
    ? resolved === 'allowed'
      ? Colors.accentGreen
      : Colors.accentRed
    : Colors.accentAmber;

  return (
    <View style={[styles.card, { borderLeftColor: borderColor }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.headerGlyph, { color: borderColor }]}>?  </Text>
        <Text style={styles.toolName}>{entry.toolName}</Text>
        <Text style={styles.headerCaption}>  wants to run</Text>
        {resolved && expanded ? (
          <TouchableOpacity
            onPress={() => setExpanded(false)}
            style={styles.collapseBtn}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Collapse"
          >
            <Text style={styles.compactChevron}>⌃</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {hasModelStrings ? (
        <View style={styles.modelBlock}>
          <Text style={styles.modelLabel}>⟨from model⟩</Text>
          {entry.title ? <Text style={styles.title}>{entry.title}</Text> : null}
          {entry.description ? <Text style={styles.description}>{entry.description}</Text> : null}
        </View>
      ) : null}

      <View style={styles.inputBlock}>
        <ScrollView style={styles.inputScroll} nestedScrollEnabled>
          <Text style={styles.inputText}>{inputJson}</Text>
        </ScrollView>
      </View>

      {resolved ? (
        <View style={styles.statusRow}>
          <Text style={styles.resolvedNote}>Resolved</Text>
        </View>
      ) : (
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.button, styles.denyButton]}
            onPress={onPressDeny}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Deny tool"
          >
            <Text style={styles.denyText}>Deny</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.allowButton]}
            onPress={onPressAllow}
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
  compactRow: {
    marginHorizontal: 12,
    marginVertical: 4,
    minHeight: 44,
    borderRadius: 8,
    borderLeftWidth: 3,
    backgroundColor: Colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  compactGlyph: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body,
    fontWeight: '700',
    width: 14,
    textAlign: 'center',
  },
  compactLabel: {
    flex: 1,
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
  },
  compactChevron: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.heading,
    fontWeight: '600',
    paddingHorizontal: 4,
  },
  collapseBtn: {
    marginLeft: 'auto',
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
  modelBlock: {
    marginTop: 8,
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  modelLabel: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontStyle: 'italic',
    marginBottom: 2,
  },
  title: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
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
  resolvedNote: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontStyle: 'italic',
  },
});
