// ──────────────────────────────────────────────
// Walccy — SessionStatusDot
// Colored dot representing a session's status.
// Pulses via Reanimated when status is waiting_input.
// ──────────────────────────────────────────────

import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  cancelAnimation,
} from 'react-native-reanimated';
import { Colors } from '../../constants/colors';
import type { SessionStatus } from '../../types';

// ── Types ─────────────────────────────────────

export interface SessionStatusDotProps {
  status: SessionStatus;
  size?: number;
  pulse?: boolean;
}

// ── Color map ─────────────────────────────────

const STATUS_COLOR: Record<SessionStatus, string> = {
  active:        Colors.accent,
  idle:          Colors.textSecondary,
  waiting_input: Colors.accentAmber,
  ended:         Colors.border,
};

// ── Component ─────────────────────────────────

export const SessionStatusDot: React.FC<SessionStatusDotProps> = ({
  status,
  size = 6,
  pulse,
}) => {
  const scale = useSharedValue(1);
  const shouldPulse = pulse ?? status === 'waiting_input';

  useEffect(() => {
    if (shouldPulse) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.4, { duration: 400 }),
          withTiming(1,   { duration: 400 })
        ),
        -1,
        false
      );
    } else {
      cancelAnimation(scale);
      scale.value = withTiming(1, { duration: 150 });
    }

    return () => {
      cancelAnimation(scale);
    };
  }, [shouldPulse, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const color = STATUS_COLOR[status];

  return (
    <Animated.View
      style={[
        styles.dot,
        animatedStyle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
      ]}
    />
  );
};

// ── Styles ────────────────────────────────────

const styles = StyleSheet.create({
  dot: {
    // width / height / borderRadius / backgroundColor set inline
  },
});
