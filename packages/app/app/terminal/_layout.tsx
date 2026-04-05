// ──────────────────────────────────────────────
// Walccy — Terminal Layout
// Wraps all terminal screens with:
//   1. Header bar (logo, hostname, status, settings)
//   2. TabBar (session tabs)
//   3. Stack navigator for session content
// ──────────────────────────────────────────────

import React from 'react';
import {
  Alert,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../constants/typography';
import { useSessionsStore } from '../../stores/sessions.store';
import { useConnectionStore, type ConnectionStatus } from '../../stores/connection.store';
import { TabBar } from '../../components/sessions/TabBar';

// ── Status badge ──────────────────────────────

interface StatusBadgeProps {
  status: ConnectionStatus;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected:    'Connected',
  connecting:   'Connecting',
  disconnected: 'Offline',
  error:        'Error',
};

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  connected:    Colors.accentGreen,
  connecting:   Colors.accentAmber,
  disconnected: Colors.textSecondary,
  error:        Colors.accentRed,
};

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => (
  <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[status] + '22' }]}>
    <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[status] }]} />
    <Text style={[styles.statusLabel, { color: STATUS_COLOR[status] }]}>
      {STATUS_LABEL[status]}
    </Text>
  </View>
);

// ── Header bar ────────────────────────────────

const HeaderBar: React.FC = () => {
  const { status, daemonHostname, latencyMs } = useConnectionStore((s) => ({
    status: s.status,
    daemonHostname: s.daemonHostname,
    latencyMs: s.latencyMs,
  }));

  return (
    <View style={styles.headerBar}>
      {/* Left: Logo */}
      <Text style={styles.headerLogo}>⬡ Walccy</Text>

      {/* Center: Hostname */}
      <Text style={styles.headerHostname} numberOfLines={1}>
        {daemonHostname ?? '—'}
      </Text>

      {/* Right: Status + latency + settings */}
      <View style={styles.headerRight}>
        <StatusBadge status={status} />
        {latencyMs != null && (
          <Text style={styles.latencyText}>{latencyMs}ms</Text>
        )}
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => router.push('/settings')}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ── Layout ────────────────────────────────────

export default function TerminalLayout(): React.ReactElement {
  const sessions = useSessionsStore((s) => Object.values(s.sessions));
  const activeSessionId = useSessionsStore((s) => s.activeSessionId);
  const setActiveSession = useSessionsStore((s) => s.setActiveSession);
  const removeSession = useSessionsStore((s) => s.removeSession);

  function handleSelectSession(id: string): void {
    setActiveSession(id);
    router.push(`/terminal/${id}`);
  }

  function handleCloseSession(id: string): void {
    removeSession(id);
    // If we removed the active session, navigate to no-session
    if (activeSessionId === id) {
      router.replace('/terminal/no-session');
    }
  }

  function handleAddSession(): void {
    Alert.alert(
      'New Session',
      'Start a new session on the connected machine?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'New Session',
          onPress: () => {
            // Navigate to a new-session screen or show an input prompt.
            // The actual session creation is handled by the daemon;
            // here we navigate to a placeholder until it appears.
            router.push('/terminal/new');
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <HeaderBar />

      {/* Tab bar */}
      <TabBar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onCloseSession={handleCloseSession}
        onAddSession={handleAddSession}
      />

      {/* Session content */}
      <View style={styles.content}>
        <Stack screenOptions={{ headerShown: false }} />
      </View>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // ── Header bar ────────────────────────────

  headerBar: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },

  headerLogo: {
    color: Colors.accent,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.semiBold,
    flexShrink: 0,
  },

  headerHostname: {
    flex: 1,
    color: Colors.textSecondary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
    textAlign: 'center',
  },

  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },

  // ── Status badge ──────────────────────────

  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },

  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  statusLabel: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.medium,
  },

  latencyText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
  },

  settingsButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },

  settingsIcon: {
    color: Colors.textSecondary,
    fontSize: 18,
  },

  // ── Content area ──────────────────────────

  content: {
    flex: 1,
    backgroundColor: Colors.background,
  },
});
