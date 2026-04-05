// ──────────────────────────────────────────────
// Walccy UI — BottomSheet
// Wrapper around @gorhom/bottom-sheet with dark
// theme, handle bar, optional title, and backdrop.
// ──────────────────────────────────────────────

import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import GorhomBottomSheet, {
  BottomSheetBackdrop,
  BottomSheetHandle,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { Colors } from '../../constants/colors';
import { FontSize, FontWeight } from '../../constants/typography';
import { Spacing } from '../../constants/spacing';

// ── Types ─────────────────────────────────────

export interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  snapPoints?: (string | number)[];
  title?: string;
  children: React.ReactNode;
}

// ── Component ─────────────────────────────────

export const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  snapPoints: snapPointsProp,
  title,
  children,
}) => {
  const sheetRef = useRef<GorhomBottomSheet>(null);

  const snapPoints = useMemo(
    () => snapPointsProp ?? ['50%', '90%'],
    [snapPointsProp]
  );

  // Sync open/close state with the ref
  useEffect(() => {
    if (isOpen) {
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [isOpen]);

  const handleChange = useCallback(
    (index: number) => {
      if (index === -1) {
        onClose();
      }
    },
    [onClose]
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
        pressBehavior="close"
      />
    ),
    []
  );

  const renderHandle = useCallback(
    () => (
      <BottomSheetHandle
        style={styles.handleContainer}
        indicatorStyle={styles.handleIndicator}
      />
    ),
    []
  );

  return (
    <GorhomBottomSheet
      ref={sheetRef}
      index={isOpen ? 0 : -1}
      snapPoints={snapPoints}
      enablePanDownToClose
      onClose={onClose}
      onChange={handleChange}
      backdropComponent={renderBackdrop}
      handleComponent={renderHandle}
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.handleIndicator}
    >
      {/* Header */}
      {title != null && title.length > 0 && (
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.separator} />
        </View>
      )}

      {/* Content */}
      <View style={styles.content}>{children}</View>
    </GorhomBottomSheet>
  );
};

// ── Styles ────────────────────────────────────

const styles = StyleSheet.create({
  background: {
    backgroundColor: Colors.surface,
  } as ViewStyle,

  handleContainer: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  } as ViewStyle,

  handleIndicator: {
    backgroundColor: Colors.border,
    width: 40,
    height: 4,
  } as ViewStyle,

  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: 0,
  } as ViewStyle,

  title: {
    color: Colors.textPrimary,
    fontSize: FontSize.heading,
    fontWeight: FontWeight.semiBold,
    marginBottom: Spacing.md,
  } as TextStyle,

  separator: {
    height: 1,
    backgroundColor: Colors.border,
  } as ViewStyle,

  content: {
    flex: 1,
  } as ViewStyle,
});
