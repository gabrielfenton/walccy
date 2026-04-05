// ──────────────────────────────────────────────
// Walccy — InputLockBanner
// Animated banner shown when another client has
// the input lock for a session.
// ──────────────────────────────────────────────

import React, { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize } from '../../constants/typography';

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const BANNER_HEIGHT = 36;
const AUTO_HIDE_MS = 2000;
const ANIM_DURATION = 200;

// ──────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────

interface InputLockBannerProps {
  isVisible: boolean;
  clientName: string;
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

export function InputLockBanner({ isVisible, clientName }: InputLockBannerProps): React.ReactElement {
  const translateY = useSharedValue(-BANNER_HEIGHT);

  useEffect(() => {
    if (isVisible) {
      translateY.value = withTiming(0, {
        duration: ANIM_DURATION,
        easing: Easing.out(Easing.ease),
      });

      const timer = setTimeout(() => {
        translateY.value = withTiming(-BANNER_HEIGHT, {
          duration: ANIM_DURATION,
          easing: Easing.in(Easing.ease),
        });
      }, AUTO_HIDE_MS);

      return () => clearTimeout(timer);
    } else {
      translateY.value = withTiming(-BANNER_HEIGHT, {
        duration: ANIM_DURATION,
        easing: Easing.in(Easing.ease),
      });
    }
  }, [isVisible, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[styles.banner, animatedStyle]}>
      <Text style={styles.text}>
        {'⌨️  '}
        <Text style={styles.text}>{clientName} is typing...</Text>
      </Text>
    </Animated.View>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  banner: {
    height: BANNER_HEIGHT,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.accentAmber,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    overflow: 'hidden',
  },
  text: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
  },
});
