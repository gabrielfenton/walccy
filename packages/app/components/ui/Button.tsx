// ──────────────────────────────────────────────
// Walccy UI — Button
// ──────────────────────────────────────────────

import React from 'react';
import {
  TouchableOpacity,
  Text,
  View,
  StyleSheet,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { Colors } from '../../constants/colors';
import { FontSize, FontWeight } from '../../constants/typography';
import { Spinner } from './Spinner';

// ── Types ─────────────────────────────────────

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

// ── Size maps ─────────────────────────────────

const HEIGHT: Record<NonNullable<ButtonProps['size']>, number> = {
  sm: 32,
  md: 44,
  lg: 52,
};

const FONT_SIZE: Record<NonNullable<ButtonProps['size']>, number> = {
  sm: FontSize.caption,
  md: FontSize.body,
  lg: FontSize.input,
};

const BORDER_RADIUS: Record<NonNullable<ButtonProps['size']>, number> = {
  sm: 8,
  md: 8,
  lg: 12,
};

const H_PADDING: Record<NonNullable<ButtonProps['size']>, number> = {
  sm: 12,
  md: 16,
  lg: 20,
};

const SPINNER_SIZE: Record<NonNullable<ButtonProps['size']>, 'sm' | 'md' | 'lg'> = {
  sm: 'sm',
  md: 'sm',
  lg: 'md',
};

// ── Component ─────────────────────────────────

export const Button: React.FC<ButtonProps> = ({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  fullWidth = false,
}) => {
  const isDisabled = disabled || loading;

  const containerStyle: ViewStyle[] = [
    styles.base,
    { height: HEIGHT[size], borderRadius: BORDER_RADIUS[size], paddingHorizontal: H_PADDING[size] },
    styles[`variant_${variant}`],
    fullWidth && styles.fullWidth,
    isDisabled && styles.disabled,
  ].filter(Boolean) as ViewStyle[];

  const textStyle: TextStyle[] = [
    styles.label,
    { fontSize: FONT_SIZE[size] },
    styles[`labelVariant_${variant}`],
    isDisabled && styles.labelDisabled,
  ].filter(Boolean) as TextStyle[];

  const spinnerColor =
    variant === 'primary' || variant === 'danger'
      ? Colors.textPrimary
      : Colors.accent;

  return (
    <TouchableOpacity
      style={containerStyle}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
    >
      {loading ? (
        <Spinner size={SPINNER_SIZE[size]} color={spinnerColor} />
      ) : (
        <View style={styles.inner}>
          {icon != null && <View style={styles.iconWrap}>{icon}</View>}
          <Text style={textStyle} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

// ── Styles ────────────────────────────────────

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  } as ViewStyle,

  fullWidth: {
    alignSelf: 'stretch',
  } as ViewStyle,

  disabled: {
    opacity: 0.45,
  } as ViewStyle,

  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  } as ViewStyle,

  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  label: {
    fontWeight: FontWeight.semiBold,
    letterSpacing: 0.2,
  } as TextStyle,

  // ── Variant containers ──────────────────────

  variant_primary: {
    backgroundColor: Colors.accent,
  } as ViewStyle,

  variant_secondary: {
    backgroundColor: Colors.surfaceHigh,
    borderWidth: 1,
    borderColor: Colors.border,
  } as ViewStyle,

  variant_ghost: {
    backgroundColor: 'transparent',
  } as ViewStyle,

  variant_danger: {
    backgroundColor: Colors.accentRed,
  } as ViewStyle,

  // ── Variant label colors ────────────────────

  labelVariant_primary: {
    color: '#FFFFFF',
  } as TextStyle,

  labelVariant_secondary: {
    color: Colors.textPrimary,
  } as TextStyle,

  labelVariant_ghost: {
    color: Colors.accent,
  } as TextStyle,

  labelVariant_danger: {
    color: '#FFFFFF',
  } as TextStyle,

  labelDisabled: {
    // opacity is on the container; no additional color change needed
  } as TextStyle,
});
