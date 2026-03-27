// ──────────────────────────────────────────────
// Walccy — ClipboardBubble
// Floating pill shown when system clipboard has content.
// ──────────────────────────────────────────────

import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize } from '../../constants/typography';

// ──────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────

interface ClipboardBubbleProps {
  isVisible: boolean;
  onPaste: () => void;
  onDismiss: () => void;
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

export function ClipboardBubble({
  isVisible,
  onPaste,
  onDismiss,
}: ClipboardBubbleProps): React.ReactElement | null {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(12);

  useEffect(() => {
    if (isVisible) {
      opacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.ease) });
      translateY.value = withSpring(0, { damping: 14, stiffness: 120 });
    } else {
      opacity.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.ease) });
      translateY.value = withTiming(12, { duration: 180 });
    }
  }, [isVisible, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const handlePress = () => {
    onPaste();
    onDismiss();
  };

  return (
    <Animated.View style={[styles.container, animatedStyle]} pointerEvents={isVisible ? 'auto' : 'none'}>
      <TouchableOpacity
        style={styles.pill}
        onPress={handlePress}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Paste clipboard content to terminal"
      >
        <Text style={styles.label}>📋 Paste</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 80,
    right: 16,
  },

  pill: {
    width: 90,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surfaceHigh,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  label: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: 13,
  },
});
