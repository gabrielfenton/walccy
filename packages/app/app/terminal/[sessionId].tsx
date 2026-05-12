// ──────────────────────────────────────────────
// Walccy — Terminal Session Screen
// Route: /terminal/[sessionId]
// ──────────────────────────────────────────────

import React, { useEffect, useState, useCallback } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Vibration,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';
import { useSessionsStore } from '../../stores/sessions.store';
import { wsClient } from '../../services/ws-client';
import { clipboardService } from '../../services/clipboard.service';
import { usePromptLibraryStore } from '../../stores/prompt-library.store';
import { MessageList } from '../../components/chat/MessageList';
import { Composer } from '../../components/chat/Composer';
import { ClipboardPopup } from '../../components/clipboard/ClipboardPopup';
import { ClipboardBubble } from '../../components/clipboard/ClipboardBubble';
import { ClipboardHistorySheet } from '../../components/clipboard/ClipboardHistorySheet';
import { PromptLibrarySheet } from '../../components/prompt-library/PromptLibrarySheet';
import { TextInputModal } from '../../components/ui/TextInputModal';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize } from '../../constants/typography';
import { useSettingsStore } from '../../stores/settings.store';

// ──────────────────────────────────────────────
// Empty state
// ──────────────────────────────────────────────

function EmptyState(): React.ReactElement {
  return (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconCircle}>
        <Text style={styles.emptyIcon}>▶</Text>
      </View>
      <Text style={styles.emptyTitle}>No Claude Code sessions</Text>
      <Text style={styles.emptySubtitle}>
        Run <Text style={styles.emptyCode}>claude</Text> in a terminal on your connected machine to see it here.
      </Text>
      <TouchableOpacity
        style={styles.refreshButton}
        onPress={() => wsClient.listSessions()}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Refresh sessions"
      >
        <Text style={styles.refreshButtonText}>Refresh</Text>
      </TouchableOpacity>
    </View>
  );
}

// ──────────────────────────────────────────────
// Waiting-for-input banner
// ──────────────────────────────────────────────

function WaitingBanner(): React.ReactElement {
  return (
    <View style={styles.waitingBanner}>
      <Text style={styles.waitingBannerText}>
        ⚡ Claude is waiting for your input
      </Text>
    </View>
  );
}

// ──────────────────────────────────────────────
// Read-only banner (external sessions)
// ──────────────────────────────────────────────

interface ReadOnlyBannerProps {
  cwd: string;
  onSpawnHere: () => void;
  spawning: boolean;
  spawnError: string | null;
}

function ReadOnlyBanner({
  cwd,
  onSpawnHere,
  spawning,
  spawnError,
}: ReadOnlyBannerProps): React.ReactElement {
  return (
    <View style={styles.readOnlyBanner}>
      <View style={styles.readOnlyTopRow}>
        <View style={styles.readOnlyBadge}>
          <Text style={styles.readOnlyBadgeText}>READ-ONLY</Text>
        </View>
        <Text style={styles.readOnlyText} numberOfLines={2}>
          External session — input not available. Run{' '}
          <Text style={styles.readOnlyCode}>walccy wrap claude</Text>{' '}
          in that terminal, or spawn a wrapped session here.
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.readOnlySpawnButton, spawning ? styles.readOnlySpawnButtonDisabled : null]}
        onPress={onSpawnHere}
        disabled={spawning || !cwd}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`Open new wrapped session at ${cwd}`}
      >
        <Text style={styles.readOnlySpawnButtonText}>
          {spawning ? 'Spawning…' : 'Spawn wrapped session here'}
        </Text>
      </TouchableOpacity>
      {spawnError ? (
        <Text style={styles.readOnlySpawnError} numberOfLines={2}>
          {spawnError}
        </Text>
      ) : null}
    </View>
  );
}

// ──────────────────────────────────────────────
// Main screen
// ──────────────────────────────────────────────

export default function TerminalSessionScreen(): React.ReactElement {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();

  const sessions = useSessionsStore((s) => s.sessions);
  const session = sessionId && sessionId !== 'no-session'
    ? sessions[sessionId]
    : undefined;
  const hasSessions = Object.keys(sessions).length > 0;

  const { fontSize, lineHeight, vibrationOnWaitingInput } = useSettingsStore(
    useShallow((s) => ({
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      vibrationOnWaitingInput: s.vibrationOnWaitingInput,
    }))
  );

  const [spawningHere, setSpawningHere] = useState(false);
  const [spawnError, setSpawnError] = useState<string | null>(null);
  const [showPromptLibrary, setShowPromptLibrary] = useState(false);
  const [showClipboard, setShowClipboard] = useState(false);
  const [showClipboardHistory, setShowClipboardHistory] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [clipboardContent, setClipboardContent] = useState('');
  const [showBubble, setShowBubble] = useState(false);
  const [savePromptText, setSavePromptText] = useState<string | null>(null);

  const isNoSession = !sessionId || sessionId === 'no-session';
  const showEmpty = isNoSession || !hasSessions;
  const isReadOnly = !!session && session.owned === false;

  // ── Session subscription ──────────────────────

  useEffect(() => {
    if (isNoSession || !session) return;
    wsClient.subscribe(sessionId);
    return () => {
      wsClient.unsubscribe(sessionId);
    };
  }, [sessionId, isNoSession, session]);

  // (INPUT_LOCK listener removed — v2 protocol has no input-lock concept;
  // a single daemon owns the stdin stream now.)

  // ── Vibrate when waiting for input ───────────

  const wasWaiting = React.useRef(false);
  useEffect(() => {
    if (!session) return;
    if (session.waitingForInput && !wasWaiting.current) {
      if (vibrationOnWaitingInput) {
        Vibration.vibrate(200);
      }
    }
    wasWaiting.current = session.waitingForInput;
  }, [session?.waitingForInput, vibrationOnWaitingInput]);

  // ── Clipboard service subscription ───────────

  useEffect(() => {
    clipboardService.startMonitoring();
    const unsubscribe = clipboardService.subscribe((state) => {
      setClipboardContent(state.content);
      setShowBubble(state.showBubble);
    });
    return () => {
      unsubscribe();
      clipboardService.stopMonitoring();
    };
  }, []);

  // ── Open handlers ─────────────────────────────

  const handleOpenClipboard = useCallback(() => {
    // (Reserved for header / Composer overflow menu — F23+ will surface
    // clipboard-history from a chip near the Composer.)
    setShowClipboardHistory(true);
  }, []);
  // Silence unused-var until the menu lands:
  void handleOpenClipboard;

  // ── Clipboard bubble paste ────────────────────

  const handleBubblePaste = useCallback(() => {
    if (sessionId && clipboardContent) {
      wsClient.sendUserText(sessionId, clipboardContent);
    }
    setShowBubble(false);
    clipboardService.hideBubble();
  }, [sessionId, clipboardContent]);

  const handleBubbleDismiss = useCallback(() => {
    setShowBubble(false);
    clipboardService.hideBubble();
  }, []);

  // ── Prompt library select ─────────────────────

  const handleSelectPrompt = useCallback(
    (content: string) => {
      if (sessionId) {
        wsClient.sendUserText(sessionId, content);
      }
    },
    [sessionId]
  );

  // ── Save to prompt library from ClipboardPopup ─

  const handleSaveToPromptLibrary = useCallback((text: string) => {
    setSavePromptText(text);
  }, []);

  const handleSavePromptSubmit = useCallback(
    (title: string) => {
      if (title.trim() && savePromptText) {
        usePromptLibraryStore.getState().addPrompt({
          title: title.trim(),
          content: savePromptText,
          tags: [],
          isPinned: false,
        });
      }
      setSavePromptText(null);
    },
    [savePromptText]
  );

  // ── Spawn wrapped session at this read-only session's cwd ─

  const handleSpawnHere = useCallback(async () => {
    if (!session || spawningHere) return;
    setSpawningHere(true);
    setSpawnError(null);
    try {
      const newId = await wsClient.spawnSession(session.cwd);
      router.push(`/terminal/${newId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSpawnError(msg);
    } finally {
      setSpawningHere(false);
    }
  }, [session, spawningHere, router]);

  // ─────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Read-only banner for external sessions */}
      {isReadOnly && session && (
        <ReadOnlyBanner
          cwd={session.cwd}
          onSpawnHere={handleSpawnHere}
          spawning={spawningHere}
          spawnError={spawnError}
        />
      )}

      {/* Main chat area */}
      {showEmpty ? (
        <EmptyState />
      ) : (
        <View style={styles.outputContainer}>
          <MessageList sessionId={sessionId!} />
        </View>
      )}

      {/* Waiting-for-input amber banner */}
      {!isReadOnly && session?.waitingForInput && <WaitingBanner />}

      {/* Clipboard bubble — floats above control bar */}
      <ClipboardBubble
        isVisible={showBubble}
        onPaste={handleBubblePaste}
        onDismiss={handleBubbleDismiss}
        onLongPress={() => {
          clipboardService.hideBubble();
          setShowClipboardHistory(true);
        }}
      />

      {/* Composer — hidden for read-only external sessions */}
      {!isReadOnly && !showEmpty && (
        <Composer sessionId={sessionId ?? ''} />
      )}

      {/* Clipboard popup — shown on terminal text long-press */}
      <ClipboardPopup
        isVisible={showClipboard}
        selectedText={selectedText}
        activeSessionId={sessionId ?? null}
        allSessionIds={Object.values(sessions).filter((s) => s.owned !== false).map((s) => s.id)}
        onClose={() => setShowClipboard(false)}
        onSaveToPromptLibrary={handleSaveToPromptLibrary}
      />

      {/* Clipboard history — opened from the toolbar 📋 button */}
      <ClipboardHistorySheet
        isVisible={showClipboardHistory}
        onClose={() => setShowClipboardHistory(false)}
        activeSessionId={sessionId ?? null}
      />

      {/* Prompt library sheet */}
      <PromptLibrarySheet
        isVisible={showPromptLibrary}
        onClose={() => setShowPromptLibrary(false)}
        onSelectPrompt={handleSelectPrompt}
        activeSessionId={sessionId ?? null}
      />

      {/* Save to prompt library modal (cross-platform Alert.prompt replacement) */}
      <TextInputModal
        visible={savePromptText !== null}
        title="Save to Prompt Library"
        message="Enter a title for this prompt:"
        onSubmit={handleSavePromptSubmit}
        onCancel={() => setSavePromptText(null)}
      />
    </KeyboardAvoidingView>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // ── Output area ───────────────────────────

  outputContainer: {
    flex: 1,
  },

  // ── Empty state ───────────────────────────

  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 14,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.accent + '1A',
    borderWidth: 1,
    borderColor: Colors.accent + '40',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyIcon: {
    color: Colors.accent,
    fontSize: 28,
    marginLeft: 4,
  },
  emptyTitle: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.heading,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptySubtitle: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
  emptyCode: {
    fontFamily: FontFamily.mono,
    color: Colors.textPrimary,
    backgroundColor: Colors.surface,
  },
  refreshButton: {
    marginTop: 8,
    paddingHorizontal: 28,
    paddingVertical: 11,
    backgroundColor: Colors.accent,
    borderRadius: 10,
  },
  refreshButtonText: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: '600',
  },

  // ── Waiting banner ────────────────────────

  waitingBanner: {
    height: 32,
    backgroundColor: Colors.accentAmber + '22',
    borderTopWidth: 1,
    borderTopColor: Colors.accentAmber,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  waitingBannerText: {
    color: Colors.accentAmber,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: '600',
  },

  // ── Read-only banner ──────────────────────

  readOnlyBanner: {
    flexDirection: 'column',
    gap: 8,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  readOnlyTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  readOnlyCode: {
    fontFamily: FontFamily.mono,
    color: Colors.textPrimary,
  },
  readOnlySpawnButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 6,
    backgroundColor: Colors.accent,
    maxWidth: '100%',
  },
  readOnlySpawnButtonDisabled: {
    opacity: 0.6,
  },
  readOnlySpawnButtonText: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: '600',
  },
  readOnlySpawnError: {
    color: Colors.accentRed,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    marginTop: 2,
  },
  readOnlyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: Colors.accentAmber + '33',
    borderWidth: 1,
    borderColor: Colors.accentAmber,
  },
  readOnlyBadgeText: {
    color: Colors.accentAmber,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  readOnlyText: {
    flex: 1,
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    lineHeight: 16,
  },
});
