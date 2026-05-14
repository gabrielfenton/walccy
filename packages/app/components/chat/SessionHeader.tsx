import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useShallow } from 'zustand/react/shallow';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../constants/typography';
import { useSessionsStore } from '../../stores/sessions.store';
import { useInitMetadataStore } from '../../stores/init-metadata.store';

interface SessionHeaderProps {
  sessionId: string | null;
}

type PillKind = 'idle' | 'active' | 'waiting' | 'ended' | 'errored';

const PILL_LABEL: Record<PillKind, string> = {
  idle:    'Idle',
  active:  'Working…',
  waiting: 'Waiting',
  ended:   'Ended',
  errored: 'Error',
};

const PILL_COLOR: Record<PillKind, string> = {
  idle:    Colors.textSecondary,
  active:  Colors.accentGreen,
  waiting: Colors.accentAmber,
  ended:   Colors.border,
  errored: Colors.accentRed,
};

const PulsingDot: React.FC<{ color: string }> = ({ color }) => {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.35, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1,    duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[styles.dot, { backgroundColor: color, opacity }]} />;
};

// Continue-on-laptop modal — shows the exact `cd && claude --resume` line so
// the user can copy it once and paste into a terminal.  Kept inline rather
// than as its own route because it's a transient affordance, not a screen.
const ContinueOnLaptopModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  cwd: string;
  sessionId: string;
}> = ({ visible, onClose, cwd, sessionId }) => {
  const command = `cd ${cwd} && claude --resume ${sessionId}`;
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    await Clipboard.setStringAsync(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }, [command]);
  useEffect(() => {
    if (!visible) setCopied(false);
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>Continue on laptop</Text>
          <Text style={styles.modalBody}>
            Paste this in any terminal on your machine to pick up where you left off.
          </Text>
          <View style={styles.commandBox}>
            <Text style={styles.commandText} numberOfLines={3}>
              {command}
            </Text>
          </View>
          <View style={styles.modalActions}>
            <TouchableOpacity
              style={[styles.modalButton, copied && styles.modalButtonOk]}
              onPress={onCopy}
              activeOpacity={0.7}
            >
              <Text style={[styles.modalButtonText, copied && styles.modalButtonTextOk]}>
                {copied ? 'Copied ✓' : 'Copy command'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalButtonGhost} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.modalButtonGhostText}>Close</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

export const SessionHeader: React.FC<SessionHeaderProps> = ({ sessionId }) => {
  const data = useSessionsStore(
    useShallow((s) => {
      const sess = sessionId ? s.sessions[sessionId] : undefined;
      if (!sess) return null;
      return {
        cwd:              sess.cwd,
        status:           sess.status,
        model:            sess.model,
        costSoFar:        sess.costSoFar,
        waitingForInput:  sess.waitingForInput,
        sdkSessionId:     sess.sdkSessionId,
      };
    }),
  );
  // The SDK session id (what `claude --resume` accepts) is now persisted on
  // the Session itself, so it survives app reconnects. Fall back to the
  // init-metadata store for the brief window before the daemon's
  // session-updated broadcast lands on a freshly spawned session.
  const initSessionId = useInitMetadataStore((s) =>
    sessionId ? s.byId[sessionId]?.sessionId : undefined,
  );
  const sdkSessionId = data?.sdkSessionId ?? initSessionId;
  const [resumeOpen, setResumeOpen] = useState(false);

  if (!data) return null;

  const statusStr = data.status as string;
  const kind: PillKind =
    statusStr === 'errored' ? 'errored'
    : statusStr === 'ended' ? 'ended'
    : statusStr === 'active'
      ? (data.waitingForInput ? 'waiting' : 'active')
      : (data.waitingForInput ? 'waiting' : 'idle');

  const pillColor = PILL_COLOR[kind];
  const pulsing = kind === 'active';

  let modelLabel: string | null = null;
  let modelTag: string | null = null;
  if (data.model) {
    const m = data.model.match(/^(.+?)\[([^\]]+)\]$/);
    if (m) {
      modelLabel = m[1];
      modelTag   = m[2].toUpperCase();
    } else {
      modelLabel = data.model;
    }
  }

  const idShort = sdkSessionId ? sdkSessionId.slice(0, 8) : null;

  return (
    <View style={styles.container}>
      <View style={[styles.pill, { backgroundColor: pillColor + '22' }]}>
        {pulsing
          ? <PulsingDot color={pillColor} />
          : <View style={[styles.dot, { backgroundColor: pillColor }]} />}
        <Text style={[styles.pillLabel, { color: pillColor }]}>{PILL_LABEL[kind]}</Text>
      </View>

      {modelLabel && (
        <View style={styles.modelRow}>
          <View style={styles.modelBadge}>
            <Text style={styles.modelText} numberOfLines={1}>{modelLabel}</Text>
          </View>
          {modelTag && (
            <View style={styles.modelTag}>
              <Text style={styles.modelTagText}>{modelTag}</Text>
            </View>
          )}
        </View>
      )}

      <View style={styles.spacer} />

      {idShort && (
        <TouchableOpacity
          style={styles.idChip}
          onPress={() => setResumeOpen(true)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Resume on laptop — session ${sdkSessionId}`}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
        >
          <Text style={styles.idChipPrefix}>id</Text>
          <Text style={styles.idChipText}>{idShort}…</Text>
        </TouchableOpacity>
      )}

      {(data.costSoFar ?? 0) > 0 && (
        <View style={styles.costChip}>
          <Text style={styles.costText}>${(data.costSoFar ?? 0).toFixed(4)}</Text>
        </View>
      )}

      {sdkSessionId && (
        <ContinueOnLaptopModal
          visible={resumeOpen}
          onClose={() => setResumeOpen(false)}
          cwd={data.cwd}
          sessionId={sdkSessionId}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  spacer: { flex: 1 },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pillLabel: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.medium,
  },

  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  modelBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: Colors.surfaceHigh,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modelText: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
    maxWidth: 180,
  },
  modelTag: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: Colors.accent + '33',
  },
  modelTagText: {
    color: Colors.accent,
    fontFamily: FontFamily.ui,
    fontSize: 9,
    fontWeight: FontWeight.semiBold,
    letterSpacing: 0.5,
  },

  idChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: Colors.surfaceHigh,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  idChipPrefix: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: 9,
    fontWeight: FontWeight.semiBold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  idChipText: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
  },

  costChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: Colors.surfaceHigh,
  },
  costText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalTitle: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.heading,
    fontWeight: FontWeight.semiBold,
    marginBottom: 6,
  },
  modalBody: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    marginBottom: 12,
    lineHeight: 20,
  },
  commandBox: {
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  commandText: {
    color: Colors.accent,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body - 1,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  modalButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: Colors.accent,
  },
  modalButtonOk: {
    backgroundColor: Colors.accentGreen,
  },
  modalButtonText: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.semiBold,
  },
  modalButtonTextOk: {
    color: Colors.textPrimary,
  },
  modalButtonGhost: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalButtonGhostText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.medium,
  },
});
