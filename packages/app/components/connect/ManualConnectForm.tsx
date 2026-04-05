// ──────────────────────────────────────────────
// Walccy — ManualConnectForm
// Form for manually entering connection details.
// ──────────────────────────────────────────────

import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../constants/typography';

// ── Types ─────────────────────────────────────

export interface ManualConnectFormProps {
  onConnect: (label: string, host: string, port: number, secret: string) => void;
  onCancel: () => void;
}

// ── Component ─────────────────────────────────

export const ManualConnectForm: React.FC<ManualConnectFormProps> = ({
  onConnect,
  onCancel,
}) => {
  const [label, setLabel] = useState('');
  const [host, setHost] = useState('');
  const [portText, setPortText] = useState('');
  const [secret, setSecret] = useState('');
  const [errors, setErrors] = useState<{ host?: string; secret?: string }>({});

  function validate(): boolean {
    const newErrors: { host?: string; secret?: string } = {};

    if (!host.trim()) {
      newErrors.host = 'Host is required';
    }

    if (!secret.trim()) {
      newErrors.secret = 'Secret is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function handleConnect(): void {
    if (!validate()) return;

    const portNumber = portText.trim() ? parseInt(portText.trim(), 10) : 7779;
    const resolvedPort = isNaN(portNumber) || portNumber <= 0 ? 7779 : portNumber;
    const resolvedLabel = label.trim() || host.trim();

    onConnect(resolvedLabel, host.trim(), resolvedPort, secret.trim());
  }

  return (
    <KeyboardAvoidingView
      style={styles.keyboardView}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Label field */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Label</Text>
          <TextInput
            style={styles.input}
            placeholder="Home Laptop"
            placeholderTextColor={Colors.textSecondary}
            value={label}
            onChangeText={setLabel}
            autoCapitalize="words"
            returnKeyType="next"
            selectionColor={Colors.accent}
          />
        </View>

        {/* Host field */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>
            Host <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={[styles.input, errors.host ? styles.inputError : null]}
            placeholder="my-laptop.tail12345.ts.net"
            placeholderTextColor={Colors.textSecondary}
            value={host}
            onChangeText={(v) => {
              setHost(v);
              if (errors.host) setErrors((e) => ({ ...e, host: undefined }));
            }}
            autoCapitalize="none"
            keyboardType="url"
            autoCorrect={false}
            returnKeyType="next"
            selectionColor={Colors.accent}
          />
          {errors.host ? (
            <Text style={styles.errorText}>{errors.host}</Text>
          ) : null}
        </View>

        {/* Port field */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Port</Text>
          <TextInput
            style={styles.input}
            placeholder="7779"
            placeholderTextColor={Colors.textSecondary}
            value={portText}
            onChangeText={setPortText}
            keyboardType="number-pad"
            returnKeyType="next"
            selectionColor={Colors.accent}
          />
        </View>

        {/* Secret field */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>
            Secret <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={[styles.input, errors.secret ? styles.inputError : null]}
            placeholder="••••••••"
            placeholderTextColor={Colors.textSecondary}
            value={secret}
            onChangeText={(v) => {
              setSecret(v);
              if (errors.secret) setErrors((e) => ({ ...e, secret: undefined }));
            }}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleConnect}
            selectionColor={Colors.accent}
          />
          {errors.secret ? (
            <Text style={styles.errorText}>{errors.secret}</Text>
          ) : null}
        </View>

        {/* Buttons */}
        <TouchableOpacity
          style={styles.connectButton}
          onPress={handleConnect}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Connect"
        >
          <Text style={styles.connectButtonText}>Connect</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cancelButton}
          onPress={onCancel}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

// ── Styles ────────────────────────────────────

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },

  scroll: {
    flex: 1,
  },

  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 32,
    gap: 16,
  },

  fieldGroup: {
    gap: 6,
  },

  fieldLabel: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  required: {
    color: Colors.accentRed,
  },

  input: {
    height: 44,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.input,
  },

  inputError: {
    borderColor: Colors.accentRed,
  },

  errorText: {
    color: Colors.accentRed,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
  },

  connectButton: {
    height: 48,
    borderRadius: 8,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },

  connectButtonText: {
    color: '#FFFFFF',
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.semiBold,
  },

  cancelButton: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  cancelButtonText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.medium,
  },
});
