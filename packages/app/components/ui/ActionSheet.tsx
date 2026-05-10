// ──────────────────────────────────────────────
// Walccy UI — ActionSheet
// Cross-platform replacement for Alert.alert action menus.
// Bottom-anchored auto-sized sheet with unlimited actions
// and working `destructive` styling on Android.
// ──────────────────────────────────────────────

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Colors } from '../../constants/colors';
import { FontFamily, FontWeight } from '../../constants/typography';
import { Spacing } from '../../constants/spacing';
import { Icon, type FeatherIconName } from './Icon';

export type ActionStyle = 'default' | 'primary' | 'destructive';

export interface ActionSheetItem {
  label: string;
  onPress: () => void;
  style?: ActionStyle;
  iconName?: FeatherIconName;
}

export interface ActionSheetProps {
  isVisible: boolean;
  onClose: () => void;
  /** Optional preview / context line. */
  title?: string;
  /** Optional secondary line. */
  message?: string;
  /** Action rows; cancel is auto-appended. */
  actions: ActionSheetItem[];
  cancelLabel?: string;
}

const QUOTE_HINT_RE = /^["'`].+["'`]$/;

const ROW_MIN_HEIGHT = 56;

export function ActionSheet({
  isVisible,
  onClose,
  title,
  message,
  actions,
  cancelLabel = 'Cancel',
}: ActionSheetProps): React.ReactElement {
  const screenHeight = Dimensions.get('window').height;
  const translateY = useRef(new Animated.Value(screenHeight)).current;

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
        toValue: screenHeight,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [isVisible, screenHeight, translateY]);

  const handleAction = (item: ActionSheetItem): void => {
    onClose();
    // Defer to allow close animation to begin and avoid double-dismiss races.
    setTimeout(() => item.onPress(), 0);
  };

  const titleLooksLikeQuote =
    title != null && title.length > 0 && QUOTE_HINT_RE.test(title.trim());

  const showHeader =
    (title != null && title.length > 0) ||
    (message != null && message.length > 0);

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
        accessibilityLabel="Dismiss"
      >
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <Animated.View
        style={[styles.wrapper, { transform: [{ translateY }] }]}
        pointerEvents="box-none"
      >
        {/* Primary group: header + actions */}
        <View style={styles.group}>
          {showHeader ? (
            <View style={styles.headerBlock}>
              {title != null && title.length > 0 ? (
                <Text
                  style={
                    titleLooksLikeQuote ? styles.titleQuote : styles.titleUI
                  }
                  numberOfLines={3}
                >
                  {title}
                </Text>
              ) : null}
              {message != null && message.length > 0 ? (
                <Text style={styles.message} numberOfLines={4}>
                  {message}
                </Text>
              ) : null}
            </View>
          ) : null}

          {actions.map((item, idx) => {
            const isLast = idx === actions.length - 1;
            return (
              <View key={`${item.label}-${idx}`}>
                {idx === 0 && showHeader ? (
                  <View style={styles.divider} />
                ) : null}
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => handleAction(item)}
                  activeOpacity={0.6}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                >
                  {item.iconName ? (
                    <Icon
                      name={item.iconName}
                      size={18}
                      color={iconColorFor(item.style)}
                      style={styles.rowIcon}
                    />
                  ) : null}
                  <Text style={[styles.rowLabel, labelStyleFor(item.style)]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
                {!isLast ? <View style={styles.divider} /> : null}
              </View>
            );
          })}
        </View>

        {/* Cancel group */}
        <View style={[styles.group, styles.cancelGroup]}>
          <TouchableOpacity
            style={styles.row}
            onPress={onClose}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={cancelLabel}
          >
            <Text style={[styles.rowLabel, styles.cancelLabel]}>
              {cancelLabel}
            </Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Modal>
  );
}

function labelStyleFor(style: ActionStyle | undefined): {
  color: string;
  fontWeight?: '600' | '400';
} {
  switch (style) {
    case 'destructive':
      return { color: Colors.accentRed, fontWeight: '600' };
    case 'primary':
      return { color: Colors.accent, fontWeight: '600' };
    default:
      return { color: Colors.textPrimary };
  }
}

function iconColorFor(style: ActionStyle | undefined): string {
  switch (style) {
    case 'destructive':
      return Colors.accentRed;
    case 'primary':
      return Colors.accent;
    default:
      return Colors.textSecondary;
  }
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
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? Spacing.xl : Spacing.md,
  },
  group: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    overflow: 'hidden',
  },
  cancelGroup: {
    marginTop: 6,
  },
  headerBlock: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    alignItems: 'center',
  },
  titleQuote: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.mono,
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  titleUI: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: 14,
    fontWeight: FontWeight.semiBold,
    textAlign: 'center',
  },
  message: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginHorizontal: 0,
  },
  row: {
    minHeight: ROW_MIN_HEIGHT,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIcon: {
    marginRight: Spacing.sm,
  },
  rowLabel: {
    fontFamily: FontFamily.ui,
    fontSize: 16,
    textAlign: 'center',
  },
  cancelLabel: {
    color: Colors.textPrimary,
    fontWeight: FontWeight.semiBold,
  },
});
