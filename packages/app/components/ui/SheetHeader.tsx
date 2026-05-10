// ──────────────────────────────────────────────
// Walccy UI — SheetHeader
// Centered title row with optional leading/trailing actions.
// ──────────────────────────────────────────────

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../../constants/colors';
import { FontFamily, FontWeight } from '../../constants/typography';
import { Spacing } from '../../constants/spacing';

interface SheetAction {
  label: string;
  onPress: () => void;
}

interface SheetTrailingAction extends SheetAction {
  primary?: boolean;
}

export interface SheetHeaderProps {
  title: string;
  /** Optional left-side action (typically Cancel). */
  leadingAction?: SheetAction;
  /** Optional right-side primary action (typically Done / Save). */
  trailingAction?: SheetTrailingAction;
}

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

export function SheetHeader({
  title,
  leadingAction,
  trailingAction,
}: SheetHeaderProps): React.ReactElement {
  return (
    <View style={styles.row}>
      <View style={styles.side}>
        {leadingAction ? (
          <TouchableOpacity
            onPress={leadingAction.onPress}
            activeOpacity={0.7}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={leadingAction.label}
          >
            <Text style={styles.actionSecondary}>{leadingAction.label}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.titleWrap}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      </View>

      <View style={[styles.side, styles.sideRight]}>
        {trailingAction ? (
          <TouchableOpacity
            onPress={trailingAction.onPress}
            activeOpacity={0.7}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={trailingAction.label}
          >
            <Text
              style={
                trailingAction.primary
                  ? styles.actionPrimary
                  : styles.actionSecondary
              }
            >
              {trailingAction.label}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  side: {
    minWidth: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  sideRight: {
    justifyContent: 'flex-end',
  },
  titleWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  title: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: 18,
    fontWeight: FontWeight.bold,
    textAlign: 'center',
  },
  actionPrimary: {
    color: Colors.accent,
    fontFamily: FontFamily.ui,
    fontSize: 14,
    fontWeight: FontWeight.semiBold,
  },
  actionSecondary: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: 14,
    fontWeight: FontWeight.medium,
  },
});
