// ──────────────────────────────────────────────
// Walccy — PromptSearchBar
// Search input for the prompt library.
// ──────────────────────────────────────────────

import React, { useRef } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize } from '../../constants/typography';
import { WInput } from '../ui/WInput';

// ──────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────

interface PromptSearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

export function PromptSearchBar({
  value,
  onChangeText,
  placeholder = 'Search prompts…',
}: PromptSearchBarProps): React.ReactElement {
  const inputRef = useRef<TextInput>(null);

  const handleClear = () => {
    onChangeText('');
    inputRef.current?.focus();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🔍</Text>
      <WInput
        ref={inputRef}
        variant="bare"
        containerStyle={styles.inputWrap}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        returnKeyType="search"
        clearButtonMode="never"
        accessibilityLabel="Search prompts"
      />
      {value.length > 0 && (
        <TouchableOpacity
          onPress={handleClear}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <Text style={styles.clearIcon}>✕</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 16,
    marginVertical: 8,
  },

  icon: {
    fontSize: 14,
    marginRight: 8,
  },

  inputWrap: {
    flex: 1,
  },

  clearIcon: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    marginLeft: 8,
  },
});
