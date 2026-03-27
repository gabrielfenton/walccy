// ──────────────────────────────────────────────
// Walccy UI — Spinner
// Animated loading indicator using Reanimated
// ──────────────────────────────────────────────

import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { Colors } from '../../constants/colors';

// ── Types ─────────────────────────────────────

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  color?: string;
}

// ── Size maps ─────────────────────────────────

const DIMENSION: Record<NonNullable<SpinnerProps['size']>, number> = {
  sm: 16,
  md: 24,
  lg: 32,
};

const BORDER_WIDTH: Record<NonNullable<SpinnerProps['size']>, number> = {
  sm: 2,
  md: 2.5,
  lg: 3,
};

// ── Component ─────────────────────────────────

export const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  color = Colors.accent,
}) => {
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, {
        duration: 800,
        easing: Easing.linear,
      }),
      -1,
      false
    );

    return () => {
      cancelAnimation(rotation);
    };
  }, [rotation]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const dim = DIMENSION[size];
  const bw = BORDER_WIDTH[size];

  return (
    <View style={[styles.container, { width: dim, height: dim }]}>
      <Animated.View
        style={[
          styles.ring,
          animatedStyle,
          {
            width: dim,
            height: dim,
            borderRadius: dim / 2,
            borderWidth: bw,
            borderTopColor: color,
            borderRightColor: 'transparent',
            borderBottomColor: 'transparent',
            borderLeftColor: 'transparent',
          },
        ]}
      />
    </View>
  );
};

// ── Styles ────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
  },
});
