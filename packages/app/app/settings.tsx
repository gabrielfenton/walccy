// ──────────────────────────────────────────────
// Walccy — Settings Screen
// Full-page settings with dark surface cards.
// ──────────────────────────────────────────────

import React, { useCallback } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSettingsStore } from '../stores/settings.store';
import { useConnectionStore } from '../stores/connection.store';
import { wsClient } from '../services/ws-client';
import { Colors } from '../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../constants/typography';
import type { MonoFontFamily } from '../constants/typography';

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
}

function SectionHeader({ title }: SectionHeaderProps): React.ReactElement {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{title}</Text>
    </View>
  );
}

interface RowProps {
  label: string;
  children: React.ReactNode;
  isLast?: boolean;
}

function Row({ label, children, isLast = false }: RowProps): React.ReactElement {
  return (
    <View style={[styles.row, !isLast && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowControl}>{children}</View>
    </View>
  );
}

interface ToggleRowProps {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  isLast?: boolean;
}

function ToggleRow({ label, value, onValueChange, isLast }: ToggleRowProps): React.ReactElement {
  return (
    <Row label={label} isLast={isLast}>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: Colors.border, true: Colors.accent }}
        thumbColor={Colors.textPrimary}
      />
    </Row>
  );
}

// ──────────────────────────────────────────────
// Font size stepper
// ──────────────────────────────────────────────

interface FontSizeStepperProps {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}

function FontSizeStepper({ value, min, max, onChange }: FontSizeStepperProps): React.ReactElement {
  return (
    <View style={styles.stepper}>
      <TouchableOpacity
        style={[styles.stepperButton, value <= min && styles.stepperButtonDisabled]}
        onPress={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Decrease font size"
      >
        <Text style={styles.stepperButtonText}>−</Text>
      </TouchableOpacity>
      <Text style={styles.stepperValue}>{value}px</Text>
      <TouchableOpacity
        style={[styles.stepperButton, value >= max && styles.stepperButtonDisabled]}
        onPress={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Increase font size"
      >
        <Text style={styles.stepperButtonText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

// ──────────────────────────────────────────────
// Font family picker
// ──────────────────────────────────────────────

const FONT_OPTIONS: MonoFontFamily[] = ['JetBrains Mono', 'Fira Code', 'Cascadia Code'];

interface FontPickerProps {
  value: MonoFontFamily;
  onChange: (v: MonoFontFamily) => void;
}

function FontPicker({ value, onChange }: FontPickerProps): React.ReactElement {
  return (
    <View style={styles.fontPicker}>
      {FONT_OPTIONS.map((font) => (
        <TouchableOpacity
          key={font}
          style={[styles.fontOption, value === font && styles.fontOptionActive]}
          onPress={() => onChange(font)}
          activeOpacity={0.7}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === font }}
        >
          <Text
            style={[
              styles.fontOptionText,
              value === font && styles.fontOptionTextActive,
            ]}
          >
            {font === 'JetBrains Mono' ? 'JB Mono' : font}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ──────────────────────────────────────────────
// Scrollback picker
// ──────────────────────────────────────────────

const SCROLLBACK_OPTIONS = [100, 500, 1000] as const;

interface ScrollbackPickerProps {
  value: number;
  onChange: (v: number) => void;
}

function ScrollbackPicker({ value, onChange }: ScrollbackPickerProps): React.ReactElement {
  return (
    <View style={styles.fontPicker}>
      {SCROLLBACK_OPTIONS.map((lines) => (
        <TouchableOpacity
          key={lines}
          style={[styles.fontOption, value === lines && styles.fontOptionActive]}
          onPress={() => onChange(lines)}
          activeOpacity={0.7}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === lines }}
        >
          <Text
            style={[
              styles.fontOptionText,
              value === lines && styles.fontOptionTextActive,
            ]}
          >
            {lines}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ──────────────────────────────────────────────
// Settings Screen
// ──────────────────────────────────────────────

export default function SettingsScreen(): React.ReactElement {
  const {
    fontSize,
    fontFamily,
    lineHeight,
    scrollbackLines,
    autoReconnect,
    keepScreenOn,
    vibrationOnWaitingInput,
    showClipboardPopupOnCopy,
    updateSettings,
  } = useSettingsStore((s) => ({
    fontSize: s.fontSize,
    fontFamily: s.fontFamily,
    lineHeight: s.lineHeight,
    scrollbackLines: s.scrollbackLines,
    autoReconnect: s.autoReconnect,
    keepScreenOn: s.keepScreenOn,
    vibrationOnWaitingInput: s.vibrationOnWaitingInput,
    showClipboardPopupOnCopy: s.showClipboardPopupOnCopy,
    updateSettings: s.updateSettings,
  }));

  const { daemonHost, daemonVersion } = useConnectionStore((s) => ({
    daemonHost: s.daemonHost,
    daemonVersion: s.daemonVersion,
  }));

  const handleDisconnect = useCallback(() => {
    wsClient.disconnect();
    router.replace('/connect');
  }, []);

  const handleGitHub = useCallback(() => {
    Linking.openURL('https://github.com/walccy/walccy').catch(() => {
      // Silently ignore if URL can't be opened
    });
  }, []);

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backButtonText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Connection ──────────────────────── */}
        <SectionHeader title="Connection" />
        <View style={styles.card}>
          <Row label="Host" isLast>
            <Text style={styles.valueText} numberOfLines={1}>
              {daemonHost ?? 'Not connected'}
            </Text>
          </Row>
        </View>
        <TouchableOpacity
          style={styles.destructiveButton}
          onPress={handleDisconnect}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Disconnect"
        >
          <Text style={styles.destructiveButtonText}>Disconnect</Text>
        </TouchableOpacity>

        {/* ── Display ─────────────────────────── */}
        <SectionHeader title="Display" />
        <View style={styles.card}>
          <Row label="Font Size">
            <FontSizeStepper
              value={fontSize}
              min={10}
              max={20}
              onChange={(v) => updateSettings({ fontSize: v })}
            />
          </Row>
          <Row label="Font Family">
            <FontPicker
              value={fontFamily}
              onChange={(v) => updateSettings({ fontFamily: v })}
            />
          </Row>
          <Row label="Scrollback Lines" isLast>
            <ScrollbackPicker
              value={scrollbackLines}
              onChange={(v) => updateSettings({ scrollbackLines: v })}
            />
          </Row>
        </View>

        {/* ── Behavior ────────────────────────── */}
        <SectionHeader title="Behavior" />
        <View style={styles.card}>
          <ToggleRow
            label="Auto-reconnect"
            value={autoReconnect}
            onValueChange={(v) => updateSettings({ autoReconnect: v })}
          />
          <ToggleRow
            label="Keep Screen On"
            value={keepScreenOn}
            onValueChange={(v) => updateSettings({ keepScreenOn: v })}
          />
          <ToggleRow
            label="Vibrate on Waiting Input"
            value={vibrationOnWaitingInput}
            onValueChange={(v) => updateSettings({ vibrationOnWaitingInput: v })}
          />
          <ToggleRow
            label="Clipboard Popup on Copy"
            value={showClipboardPopupOnCopy}
            onValueChange={(v) => updateSettings({ showClipboardPopupOnCopy: v })}
            isLast
          />
        </View>

        {/* ── About ───────────────────────────── */}
        <SectionHeader title="About" />
        <View style={styles.card}>
          <Row label="App Version">
            <Text style={styles.valueText}>1.0.0</Text>
          </Row>
          <Row label="Daemon Version">
            <Text style={styles.valueText}>{daemonVersion ?? '—'}</Text>
          </Row>
          <Row label="GitHub" isLast>
            <TouchableOpacity
              onPress={handleGitHub}
              activeOpacity={0.75}
              accessibilityRole="link"
              accessibilityLabel="Open GitHub"
            >
              <Text style={styles.linkText}>github.com/walccy</Text>
            </TouchableOpacity>
          </Row>
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </View>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // ── Header ────────────────────────────────

  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backButton: {
    paddingVertical: 8,
    paddingRight: 12,
    minWidth: 64,
  },
  backButtonText: {
    color: Colors.accent,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.medium,
  },
  headerTitle: {
    flex: 1,
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.heading,
    fontWeight: FontWeight.semiBold,
    textAlign: 'center',
  },
  headerSpacer: {
    minWidth: 64,
  },

  // ── Scroll area ───────────────────────────

  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },

  // ── Section header ────────────────────────

  sectionHeader: {
    marginTop: 8,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  sectionHeaderText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  // ── Card ──────────────────────────────────

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    marginBottom: 12,
  },

  // ── Row ───────────────────────────────────

  row: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowLabel: {
    flex: 1,
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
  },
  rowControl: {
    flexShrink: 0,
    alignItems: 'flex-end',
  },

  // ── Value text ────────────────────────────

  valueText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.terminal,
  },

  // ── Link ──────────────────────────────────

  linkText: {
    color: Colors.accent,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
  },

  // ── Stepper ───────────────────────────────

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  stepperButton: {
    width: 28,
    height: 28,
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  stepperButtonDisabled: {
    opacity: 0.35,
  },
  stepperButtonText: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: 16,
    lineHeight: 20,
  },
  stepperValue: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.terminal,
    minWidth: 36,
    textAlign: 'center',
  },

  // ── Font picker / scrollback picker ───────

  fontPicker: {
    flexDirection: 'row',
    gap: 4,
  },
  fontOption: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: Colors.surfaceHigh,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  fontOptionActive: {
    backgroundColor: Colors.accent + '33',
    borderColor: Colors.accent,
  },
  fontOptionText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
  },
  fontOptionTextActive: {
    color: Colors.accent,
    fontWeight: FontWeight.semiBold,
  },

  // ── Disconnect button ─────────────────────

  destructiveButton: {
    backgroundColor: Colors.accentRed + '22',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.accentRed + '66',
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  destructiveButtonText: {
    color: Colors.accentRed,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.semiBold,
  },

  // ── Bottom padding ────────────────────────

  bottomPadding: {
    height: 40,
  },
});
