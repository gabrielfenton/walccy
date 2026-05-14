// ──────────────────────────────────────────────
// Walccy — WInput
// Reusable text-input primitive with three variants:
//   • variant="short" — single-line boxed input (names, ids, form fields)
//   • variant="long"  — multiline boxed input (chat composer, prompts)
//   • variant="bare"  — undecorated input, embed in a host-styled
//                       container (search bars with their own icon/clear)
// Encodes our keyboard / styling best practices in one place so
// every screen behaves consistently.
// ──────────────────────────────────────────────

import React, { forwardRef } from 'react';
import {
  Platform,
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize } from '../../constants/typography';

type WInputVariant = 'short' | 'long' | 'bare';

export interface WInputProps extends Omit<TextInputProps, 'style' | 'multiline'> {
  variant?: WInputVariant;
  monospace?: boolean;
  /** Extra style applied to the inner TextInput (e.g. flex sizing). */
  inputStyle?: StyleProp<TextStyle>;
  /** Extra style applied to the wrapper View (e.g. layout). */
  containerStyle?: StyleProp<ViewStyle>;
  /** Cap for the multiline variant — defaults to 120 (≈5 lines). */
  maxHeight?: number;
}

/**
 * Best-practice defaults per variant:
 *
 *   short:  single line, returnKeyType=done, autoCorrect off, no
 *           auto-capitalize (search/name/id fields). Boxed decoration.
 *   long:   multiline, scrollEnabled, blurOnSubmit=false so Return inserts
 *           a newline rather than dismissing the keyboard. Boxed.
 *   bare:   no background/border — caller's container draws the chrome.
 *           Single-line like `short`, but defaults returnKeyType='search'
 *           since the intended use is search bars. Multiline is bound to
 *           the `long` variant — a bare multiline input isn't supported;
 *           use `long` with an inputStyle that strips the box decoration.
 *
 * Keyboard avoidance is the *host screen's* responsibility (wrap with
 * KeyboardAvoidingView at the layout root).  This component intentionally
 * doesn't wrap itself in a KAV so it composes with sheets, modals, and
 * scroll views without fighting them.
 */
export const WInput = forwardRef<TextInput, WInputProps>(function WInput(
  {
    variant = 'short',
    monospace = false,
    inputStyle,
    containerStyle,
    maxHeight = 120,
    placeholderTextColor,
    selectionColor,
    autoCorrect,
    autoCapitalize,
    returnKeyType,
    blurOnSubmit,
    ...rest
  },
  ref,
): React.ReactElement {
  const isLong = variant === 'long';

  return (
    <View style={[styles.container, containerStyle]}>
      <TextInput
        ref={ref}
        // `...rest` first so variant-defining props below always win — a
        // caller can't accidentally override multiline/scrollEnabled/etc.
        {...rest}
        multiline={isLong}
        scrollEnabled={isLong}
        // For long-form, Return inserts a newline (parent has its own send button).
        blurOnSubmit={blurOnSubmit ?? !isLong}
        returnKeyType={
          returnKeyType ??
          (isLong ? 'default' : variant === 'bare' ? 'search' : 'done')
        }
        autoCorrect={autoCorrect ?? (isLong ? undefined : false)}
        // Single-line variants are search/name/id fields — don't auto-capitalize.
        autoCapitalize={autoCapitalize ?? (isLong ? 'sentences' : 'none')}
        placeholderTextColor={placeholderTextColor ?? Colors.textSecondary}
        selectionColor={selectionColor ?? Colors.accent}
        // On Android, padding behaves slightly differently for multiline —
        // textAlignVertical keeps the cursor at the top while typing.
        textAlignVertical={isLong ? 'top' : 'center'}
        style={[
          styles.base,
          variant === 'long'
            ? [styles.long, { maxHeight }]
            : variant === 'bare'
              ? styles.bare
              : styles.short,
          monospace ? styles.mono : null,
          inputStyle,
        ]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  base: {
    flex: 1,
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.input,
  },
  short: {
    minHeight: 44, // iOS HIG tap target
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
  },
  long: {
    minHeight: 44,
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    // lineHeight only on multiline — on single-line inputs it can break
    // vertical centering on Android.
    lineHeight: FontSize.input * 1.35,
  },
  bare: {
    // No box decoration — the host container draws background/border.
    paddingVertical: 0,
  },
  mono: {
    fontFamily: FontFamily.mono,
  },
});
