// ──────────────────────────────────────────────
// Walccy UI — StatusBadge
// Dot indicator with optional text label.
// "connecting" pulses using Reanimated.
// ──────────────────────────────────────────────

import React, { useEffect } from 'react';
import { StyleSheet, Text, View, type ViewStyle, type TextStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  cancelAnimation,
} from 'react-native-reanimated';
import { Colors } from '../../constants/colors';
import { FontSize, FontWeight } from '../../constants/typography';

// ── Types ─────────────────────────────────────

export interface StatusBadgeProps {
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  label?: string;
  size?: 'sm' | 'md';
}

// ── Color map ─────────────────────────────────

const DOT_COLOR: Record<StatusBadgeProps['status'], string> = {
  connected:    Colors.accentGreen,
  connecting:   Colors.accentAmber,
  disconnected: Colors.textSecondary,
  error:        Colors.accentRed,
};

// ── Dot size map ──────────────────────────────

const DOT_DIM: Record<NonNullable<StatusBadgeProps['size']>, number> = {
  sm: 6,
  md: 8,
};

const LABEL_FONT: Record<NonNullable<StatusBadgeProps['size']>, number> = {
  sm: FontSize.caption,
  md: FontSize.body,
};

// ── Component ─────────────────────────────────

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  label,
  size = 'md',
}) => {
  const opacity = useSharedValue(1);
  const isPulsing = status === 'connecting';

  useEffect(() => {
    if (isPulsing) {
      opacity.value = withRepeat(
        withSequence(
          withTiming(0.3, { duration: 600 }),
          withTiming(1, { duration: 600 })
        ),
        -1,
        false
      );
    } else {
      cancelAnimation(opacity);
      opacity.value = 1;
    }

    return () => {
      cancelAnimation(opacity);
    };
  }, [isPulsing, opacity]);

  const animatedDotStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const dim = DOT_DIM[size];
  const dotColor = DOT_COLOR[status];

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.dot,
          animatedDotStyle,
          {
            width: dim,
            height: dim,
            borderRadius: dim / 2,
            backgroundColor: dotColor,
          } as ViewStyle,
        ]}
      />
      {label != null && label.length > 0 && (
        <Text
          style={[
            styles.label,
            { fontSize: LABEL_FONT[size] } as TextStyle,
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
    </View>
  );
};

// ── Styles ────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  } as ViewStyle,

  dot: {
    // width / height / borderRadius / backgroundColor set inline
  } as ViewStyle,

  label: {
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
  } as TextStyle,
});
