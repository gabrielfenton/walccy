// ──────────────────────────────────────────────
// Walccy UI — SheetSearchBar
// 40pt pill search input with leading search icon
// and trailing clear-X (when value is non-empty).
// ──────────────────────────────────────────────

import React from 'react';
import {
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize } from '../../constants/typography';
import { Spacing } from '../../constants/spacing';
import { Icon } from './Icon';

export interface SheetSearchBarProps {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  /** Use mono font for the input. Default false. */
  monospace?: boolean;
}

export function SheetSearchBar({
  value,
  onChangeText,
  placeholder = 'Search…',
  onSubmit,
  monospace = false,
}: SheetSearchBarProps): React.ReactElement {
  const hasValue = value.length > 0;

  return (
    <View style={styles.container}>
      <Icon name="search" size={16} color={Colors.textSecondary} style={styles.leadingIcon} />
      <TextInput
        style={[
          styles.input,
          { fontFamily: monospace ? FontFamily.mono : FontFamily.ui },
        ]}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor={Colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="search"
        accessibilityLabel={placeholder}
      />
      {hasValue ? (
        <TouchableOpacity
          onPress={() => onChangeText('')}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          style={styles.clearBtn}
        >
          <Icon name="x" size={16} color={Colors.textSecondary} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 10,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  leadingIcon: {
    marginRight: Spacing.sm,
  },
  input: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: FontSize.input,
    paddingVertical: 0,
  },
  clearBtn: {
    paddingLeft: Spacing.sm,
  },
});
