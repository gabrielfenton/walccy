// ──────────────────────────────────────────────
// Walccy — Terminal Layout
// Wraps all terminal screens with:
//   1. Header bar (logo, hostname, status, settings)
//   2. TabBar (session tabs)
//   3. Stack navigator for session content
// ──────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { Stack, router } from 'expo-router';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../constants/typography';
import { useSessionsStore } from '../../stores/sessions.store';
import { useConnectionStore, type ConnectionStatus } from '../../stores/connection.store';
import { wsClient } from '../../services/ws-client';
import { TabBar } from '../../components/sessions/TabBar';
import { NewSessionSheet } from '../../components/sessions/NewSessionSheet';
import { SessionHeader } from '../../components/chat/SessionHeader';

// ── Offline-too-long banner ───────────────────
//
// Surfaces under the header when the WS has been non-connected for
// more than OFFLINE_GRACE_MS.  Brief disconnect/reconnect cycles
// (idle drops, backgrounding) stay silent; only stuck-offline draws
// attention.  The most common cause for a stuck phone is Tailscale
// being toggled off, so the body text leads with that.

const OFFLINE_GRACE_MS = 8000;

const OfflineBanner: React.FC = () => {
  const status = useConnectionStore((s) => s.status);
  const [longOffline, setLongOffline] = useState(false);

  useEffect(() => {
    if (status === 'connected') {
      setLongOffline(false);
      return;
    }
    const t = setTimeout(() => setLongOffline(true), OFFLINE_GRACE_MS);
    return () => clearTimeout(t);
  }, [status]);

  if (!longOffline || status === 'connected') return null;

  return (
    <View style={styles.offlineBanner}>
      <Text style={styles.offlineBannerTitle}>Can't reach the daemon</Text>
      <Text style={styles.offlineBannerBody} numberOfLines={3}>
        If you're off your home Wi-Fi, swipe down and tap the Tailscale tile
        to bring the VPN up. Otherwise check that the daemon is running on
        your computer.
      </Text>
    </View>
  );
};

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
  const { status, daemonHostname, latencyMs, lastError } = useConnectionStore(
    useShallow((s) => ({
      status: s.status,
      daemonHostname: s.daemonHostname,
      latencyMs: s.latencyMs,
      lastError: s.lastError,
    }))
  );

  return (
    <View style={styles.headerBar}>
      {/* Left: Logo */}
      <Text style={styles.headerLogo}>⬡ Walccy</Text>

      {/* Center: Hostname or error message */}
      <Text style={[styles.headerHostname, lastError ? styles.headerError : undefined]} numberOfLines={1}>
        {lastError ?? daemonHostname ?? '—'}
      </Text>

      {/* Right: Status + latency + settings */}
      <View style={styles.headerRight}>
        <StatusBadge status={status} />
        {latencyMs != null && latencyMs < 5000 && status === 'connected' && (
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
  const sessions = useSessionsStore(useShallow((s) => Object.values(s.sessions)));
  const activeSessionId = useSessionsStore((s) => s.activeSessionId);
  const setActiveSession = useSessionsStore((s) => s.setActiveSession);

  const [newSessionSheetVisible, setNewSessionSheetVisible] = useState(false);

  function handleSelectSession(id: string): void {
    setActiveSession(id);
    router.push(`/terminal/${id}`);
  }

  function handleCloseSession(id: string): void {
    // The daemon will SIGTERM the underlying claude process and broadcast
    // SESSION_REMOVED, which the ws-client uses to drop the session from
    // the store.  We navigate eagerly so the UI doesn't briefly show a
    // dying tab.
    wsClient.killSession(id);
    if (activeSessionId === id) {
      router.replace('/terminal/no-session');
    }
  }

  function handleAddSession(): void {
    setNewSessionSheetVisible(true);
  }

  function handleSessionSpawned(sessionId: string): void {
    // Daemon also broadcasts SESSION_ADDED so it'll appear in the tab bar.
    // Mark it active and navigate so the user lands on it immediately.
    setActiveSession(sessionId);
    wsClient.subscribe(sessionId);
    router.push(`/terminal/${sessionId}`);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* Header */}
      <HeaderBar />

      {/* Stuck-offline hint */}
      <OfflineBanner />

      {/* Tab bar */}
      <TabBar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onCloseSession={handleCloseSession}
        onAddSession={handleAddSession}
      />

      {/* Per-session metadata */}
      <SessionHeader sessionId={activeSessionId} />

      {/* Session content */}
      <View style={styles.content}>
        <Stack screenOptions={{ headerShown: false }} />
      </View>

      <NewSessionSheet
        isVisible={newSessionSheetVisible}
        onClose={() => setNewSessionSheetVisible(false)}
        onSpawned={handleSessionSpawned}
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // ── Offline banner ─────────────────────────

  offlineBanner: {
    backgroundColor: Colors.accentAmber + '22',
    borderBottomWidth: 1,
    borderBottomColor: Colors.accentAmber + '55',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  offlineBannerTitle: {
    color: Colors.accentAmber,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semiBold,
    marginBottom: 2,
  },
  offlineBannerBody: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    lineHeight: 16,
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

  headerError: {
    color: Colors.accentRed,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
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
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  settingsIcon: {
    color: Colors.textSecondary,
    fontSize: 20,
  },

  // ── Content area ──────────────────────────

  content: {
    flex: 1,
    backgroundColor: Colors.background,
  },
});
