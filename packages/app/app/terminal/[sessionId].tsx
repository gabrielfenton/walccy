// ──────────────────────────────────────────────
// Walccy — Terminal Session Screen
// Route: /terminal/[sessionId]
// ──────────────────────────────────────────────

import React, { useEffect, useState, useCallback } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Vibration,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSessionsStore } from '../../stores/sessions.store';
import { wsClient } from '../../services/ws-client';
import { clipboardService } from '../../services/clipboard.service';
import { usePromptLibraryStore } from '../../stores/prompt-library.store';
import { TerminalOutput } from '../../components/terminal/TerminalOutput';
import { ControlBar } from '../../components/terminal/ControlBar';
import { InputBar } from '../../components/terminal/InputBar';
import { InputLockBanner } from '../../components/terminal/InputLockBanner';
import { ClipboardPopup } from '../../components/clipboard/ClipboardPopup';
import { ClipboardBubble } from '../../components/clipboard/ClipboardBubble';
import { PromptLibrarySheet } from '../../components/prompt-library/PromptLibrarySheet';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize } from '../../constants/typography';
import { useSettingsStore } from '../../stores/settings.store';
import type { ServerMessage } from '../../types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface InputLockState {
  active: boolean;
  clientName: string;
}

// ──────────────────────────────────────────────
// Empty state
// ──────────────────────────────────────────────

function EmptyState(): React.ReactElement {
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>▶</Text>
      <Text style={styles.emptyTitle}>No Claude Code sessions</Text>
      <Text style={styles.emptySubtitle}>
        Start claude in your terminal to see it here
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
// Main screen
// ──────────────────────────────────────────────

export default function TerminalSessionScreen(): React.ReactElement {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();

  const sessions = useSessionsStore((s) => s.sessions);
  const session = sessionId && sessionId !== 'no-session'
    ? sessions[sessionId]
    : undefined;
  const hasSessions = Object.keys(sessions).length > 0;

  const { fontSize, lineHeight, vibrationOnWaitingInput } = useSettingsStore((s) => ({
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    vibrationOnWaitingInput: s.vibrationOnWaitingInput,
  }));

  const [inputLockState, setInputLockState] = useState<InputLockState>({
    active: false,
    clientName: '',
  });

  const [showPromptLibrary, setShowPromptLibrary] = useState(false);
  const [showClipboard, setShowClipboard] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [clipboardContent, setClipboardContent] = useState('');
  const [showBubble, setShowBubble] = useState(false);

  const isNoSession = !sessionId || sessionId === 'no-session';
  const showEmpty = isNoSession || !hasSessions;

  // ── Session subscription ──────────────────────

  useEffect(() => {
    if (isNoSession || !session) return;
    wsClient.subscribe(sessionId);
    return () => {
      wsClient.unsubscribe(sessionId);
    };
  }, [sessionId, isNoSession, session]);

  // ── INPUT_LOCK listener ───────────────────────

  useEffect(() => {
    if (isNoSession) return;

    const unsubscribe = wsClient.onMessage((msg: ServerMessage) => {
      if (msg.type === 'INPUT_LOCK' && msg.sessionId === sessionId) {
        setInputLockState({
          active: true,
          clientName: msg.lockedByClientName,
        });
      }
    });

    return unsubscribe;
  }, [sessionId, isNoSession]);

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

  // ── Long press on terminal text ───────────────

  const handleTextLongPress = useCallback((text: string) => {
    setSelectedText(text);
    setShowClipboard(true);
  }, []);

  // ── Open handlers ─────────────────────────────

  const handleOpenPromptLibrary = useCallback(() => {
    setShowPromptLibrary(true);
  }, []);

  const handleOpenClipboard = useCallback(() => {
    setShowClipboard(true);
  }, []);

  // ── Clipboard bubble paste ────────────────────

  const handleBubblePaste = useCallback(() => {
    if (sessionId && clipboardContent) {
      wsClient.sendInput(sessionId, clipboardContent);
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
        wsClient.sendInput(sessionId, content);
      }
    },
    [sessionId]
  );

  // ── Save to prompt library from ClipboardPopup ─

  const handleSaveToPromptLibrary = useCallback((text: string) => {
    Alert.prompt(
      'Save to Prompt Library',
      'Enter a title for this prompt:',
      (title) => {
        if (title?.trim()) {
          usePromptLibraryStore.getState().addPrompt({
            title: title.trim(),
            content: text,
            tags: [],
            isPinned: false,
          });
        }
      },
      'plain-text'
    );
  }, []);

  // ─────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Input lock banner */}
      <InputLockBanner
        isVisible={inputLockState.active}
        clientName={inputLockState.clientName}
      />

      {/* Main output area */}
      {showEmpty ? (
        <EmptyState />
      ) : (
        <View style={styles.outputContainer}>
          <TerminalOutput
            sessionId={sessionId!}
            fontSize={fontSize}
            lineHeight={lineHeight}
            onTextLongPress={handleTextLongPress}
          />
        </View>
      )}

      {/* Waiting-for-input amber banner */}
      {session?.waitingForInput && <WaitingBanner />}

      {/* Clipboard bubble — floats above control bar */}
      <ClipboardBubble
        isVisible={showBubble}
        onPaste={handleBubblePaste}
        onDismiss={handleBubbleDismiss}
      />

      {/* Control bar */}
      <ControlBar
        sessionId={sessionId ?? ''}
        onOpenPromptLibrary={handleOpenPromptLibrary}
        onOpenClipboard={handleOpenClipboard}
      />

      {/* Input bar */}
      <InputBar
        sessionId={sessionId ?? ''}
        waitingForInput={session?.waitingForInput ?? false}
      />

      {/* Clipboard popup — shown on terminal text long-press */}
      <ClipboardPopup
        isVisible={showClipboard}
        selectedText={selectedText}
        activeSessionId={sessionId ?? null}
        allSessionIds={Object.keys(sessions)}
        onClose={() => setShowClipboard(false)}
        onSaveToPromptLibrary={handleSaveToPromptLibrary}
      />

      {/* Prompt library sheet */}
      <PromptLibrarySheet
        isVisible={showPromptLibrary}
        onClose={() => setShowPromptLibrary(false)}
        onSelectPrompt={handleSelectPrompt}
        activeSessionId={sessionId ?? null}
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
    gap: 12,
  },
  emptyIcon: {
    color: Colors.textSecondary,
    fontSize: 48,
    marginBottom: 8,
  },
  emptyTitle: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.heading,
    textAlign: 'center',
  },
  emptySubtitle: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    textAlign: 'center',
    lineHeight: 20,
  },
  refreshButton: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: Colors.accent,
    borderRadius: 8,
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
});
