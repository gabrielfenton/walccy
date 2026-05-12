import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../constants/typography';
import { useSessionsStore } from '../../stores/sessions.store';

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

export const SessionHeader: React.FC<SessionHeaderProps> = ({ sessionId }) => {
  const data = useSessionsStore(
    useShallow((s) => {
      const sess = sessionId ? s.sessions[sessionId] : undefined;
      if (!sess) return null;
      return {
        status:           sess.status,
        model:            sess.model,
        costSoFar:        sess.costSoFar,
        waitingForInput:  sess.waitingForInput,
      };
    }),
  );

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

      {(data.costSoFar ?? 0) > 0 && (
        <View style={styles.costChip}>
          <Text style={styles.costText}>${(data.costSoFar ?? 0).toFixed(4)}</Text>
        </View>
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
});
