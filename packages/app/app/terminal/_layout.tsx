// ──────────────────────────────────────────────
// Walccy — Terminal Layout
// Wraps all terminal screens with:
//   1. Header bar (logo, hostname, status, settings)
//   2. TabBar (session tabs)
//   3. Stack navigator for session content
// ──────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { Stack, router, usePathname } from 'expo-router';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../constants/typography';
import { useSessionsStore } from '../../stores/sessions.store';
import { useConnectionStore, type ConnectionStatus } from '../../stores/connection.store';
import { wsClient } from '../../services/ws-client';
import { TabBar } from '../../components/sessions/TabBar';
import { NewSessionSheet } from '../../components/sessions/NewSessionSheet';
import { SessionHeader } from '../../components/chat/SessionHeader';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';

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

  // Lift the layout above the keyboard. Expo SDK 54 edge-to-edge breaks both
  // `adjustResize` and `adjustPan` (the RN view tree never moves out from
  // behind the IME), so on Android we shrink the SafeAreaView by the live
  // keyboard height — the `flex:1` content area absorbs it and the
  // bottom-pinned Composer lands right above the keyboard. iOS still uses the
  // KAV `padding` behavior below.
  const keyboardHeight = useKeyboardHeight();
  const androidKeyboardPad =
    Platform.OS === 'android' && keyboardHeight > 0
      ? { paddingBottom: keyboardHeight }
      : null;

  // Cold-start / post-kill / post-reconnect recovery: connect.tsx always
  // routes to `/terminal/no-session`, but if the daemon already has
  // sessions we shouldn't strand the user on the empty state with a
  // populated tab bar.  Whenever we're on the no-session route and any
  // sessions exist, jump to the previously-active one if it still exists,
  // else the most-recently-active session.
  const pathname = usePathname();
  useEffect(() => {
    if (pathname !== '/terminal/no-session') return;
    if (sessions.length === 0) return;
    const preserved = activeSessionId
      ? sessions.find((s) => s.id === activeSessionId)
      : null;
    const target =
      preserved ??
      [...sessions].sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0];
    if (target) {
      setActiveSession(target.id);
      router.replace(`/terminal/${target.id}`);
    }
  }, [pathname, activeSessionId, sessions, setActiveSession]);

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
    <KeyboardAvoidingView
      style={styles.kav}
      // iOS uses padding-based avoidance. On Android the OS handles it via
      // `windowSoftInputMode=adjustPan` (Expo SDK 54 enforces edge-to-edge,
      // under which `adjustResize` no longer shrinks the RN view tree and
      // a JS-side KAV gets no usable keyboard height) — so behavior is left
      // undefined there to avoid fighting the OS pan.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      // KAV wraps SafeAreaView whose top edge is the window top, so no
      // offset is needed. Explicit 0 documents that — revisit if any
      // chrome is ever added above this KAV.
      keyboardVerticalOffset={0}
    >
    <SafeAreaView style={[styles.safeArea, androidKeyboardPad]} edges={['top', 'left', 'right']}>
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
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────

const styles = StyleSheet.create({
  kav: {
    flex: 1,
    backgroundColor: Colors.background,
  },
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
