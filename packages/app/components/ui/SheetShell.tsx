// ──────────────────────────────────────────────
// Walccy UI — SheetShell
// Standardised modal-bottom-sheet container.
// Backdrop + spring-in / timing-out animation +
// keyboard avoidance + visual handle bar.
// ──────────────────────────────────────────────

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Colors } from '../../constants/colors';

export interface SheetShellProps {
  isVisible: boolean;
  onClose: () => void;
  /** Fraction of window height the sheet occupies. Default 0.78. */
  heightRatio?: number;
  children: React.ReactNode;
  /** When true (default), wraps children in a KeyboardAvoidingView with platform-correct behavior. */
  avoidKeyboard?: boolean;
}

export function SheetShell({
  isVisible,
  onClose,
  heightRatio = 0.78,
  children,
  avoidKeyboard = true,
}: SheetShellProps): React.ReactElement {
  const sheetHeight = Dimensions.get('window').height * heightRatio;
  const translateY = useRef(new Animated.Value(sheetHeight)).current;

  useEffect(() => {
    if (isVisible) {
      Animated.spring(translateY, {
        toValue: 0,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: sheetHeight,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [isVisible, sheetHeight, translateY]);

  // On Android we rely on windowSoftInputMode=adjustResize from the manifest;
  // 'height' behavior misbehaves with statusBarTranslucent modals.
  const kavBehavior = Platform.OS === 'ios' ? 'padding' : undefined;

  const Inner: React.ReactNode = avoidKeyboard ? (
    <KeyboardAvoidingView style={styles.sheetInner} behavior={kavBehavior}>
      {children}
    </KeyboardAvoidingView>
  ) : (
    <View style={styles.sheetInner}>{children}</View>
  );

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close sheet"
      >
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <Animated.View
        style={[
          styles.sheet,
          { height: sheetHeight, transform: [{ translateY }] },
        ]}
      >
        <View style={styles.handleWrap} pointerEvents="none">
          <View style={styles.handleBar} />
        </View>
        {Inner}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  sheetInner: {
    flex: 1,
  },
  handleWrap: {
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  handleBar: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
  },
});
