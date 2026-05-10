// ──────────────────────────────────────────────
// Walccy — TextInputModal
// Cross-platform replacement for Alert.prompt (iOS-only).
// ──────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../constants/typography';
import { Spacing } from '../../constants/spacing';

interface TextInputModalProps {
  visible: boolean;
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function TextInputModal({
  visible,
  title,
  message,
  defaultValue = '',
  placeholder,
  onSubmit,
  onCancel,
}: TextInputModalProps): React.ReactElement {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (visible) {
      setValue(defaultValue);
    }
  }, [visible, defaultValue]);

  const handleSubmit = () => {
    onSubmit(value);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <TouchableWithoutFeedback onPress={onCancel}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={styles.dialog}>
              <Text style={styles.title}>{title}</Text>
              {message ? <Text style={styles.message}>{message}</Text> : null}
              <TextInput
                style={styles.input}
                value={value}
                onChangeText={setValue}
                placeholder={placeholder}
                placeholderTextColor={Colors.textSecondary}
                autoFocus
                onSubmitEditing={handleSubmit}
                returnKeyType="done"
              />
              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={onCancel}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.submitButton}
                  onPress={handleSubmit}
                  activeOpacity={0.7}
                >
                  <Text style={styles.submitText}>OK</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  dialog: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  title: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.heading,
    fontWeight: FontWeight.bold,
    textAlign: 'center',
  },
  message: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    textAlign: 'center',
  },
  input: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: Spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  cancelButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: 6,
  },
  cancelText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
  },
  submitButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: 6,
    backgroundColor: Colors.accent,
  },
  submitText: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.semiBold,
  },
});
