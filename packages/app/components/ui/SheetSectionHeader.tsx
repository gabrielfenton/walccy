// ──────────────────────────────────────────────
// Walccy UI — SheetSectionHeader
// Uppercase letterspaced section label.
// ──────────────────────────────────────────────

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors } from '../../constants/colors';
import { FontFamily, FontWeight } from '../../constants/typography';
import { Spacing } from '../../constants/spacing';

export interface SheetSectionHeaderProps {
  title: string;
}

export function SheetSectionHeader({
  title,
}: SheetSectionHeaderProps): React.ReactElement {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
    backgroundColor: 'transparent',
  },
  text: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: 11,
    fontWeight: FontWeight.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
});
