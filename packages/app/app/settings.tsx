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
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../stores/settings.store';
import { useConnectionStore } from '../stores/connection.store';
import { useSessionsStore } from '../stores/sessions.store';
import { useInitMetadataStore } from '../stores/init-metadata.store';
import { wsClient } from '../services/ws-client';
import { Colors } from '../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../constants/typography';
import type { MonoFontFamily } from '../constants/typography';
import type { EffortLevel } from '@walccy/protocol';

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
// MCP status pill
// ──────────────────────────────────────────────

const MCP_STATUS_STYLE: Record<
  string,
  { bg: string; fg: string; label: string }
> = {
  connected:    { bg: Colors.accentGreen + '22', fg: Colors.accentGreen, label: 'connected' },
  failed:       { bg: Colors.accentRed + '22',   fg: Colors.accentRed,   label: 'failed'    },
  'needs-auth': { bg: Colors.accentAmber + '22', fg: Colors.accentAmber, label: 'auth'      },
  pending:      { bg: Colors.surfaceHigh,        fg: Colors.textSecondary, label: 'pending' },
  disabled:     { bg: Colors.surfaceHigh,        fg: Colors.textSecondary, label: 'off'     },
};

function McpStatusPill({ status }: { status: string }): React.ReactElement {
  const cfg = MCP_STATUS_STYLE[status] ?? MCP_STATUS_STYLE.pending!;
  return (
    <View style={[styles.mcpPill, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.mcpPillText, { color: cfg.fg }]}>{cfg.label}</Text>
    </View>
  );
}

// ──────────────────────────────────────────────
// Generic chip picker (used for model/effort/output style)
// ──────────────────────────────────────────────

interface ChipPickerProps<T extends string> {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}

function ChipPicker<T extends string>({
  value,
  options,
  onChange,
}: ChipPickerProps<T>): React.ReactElement {
  return (
    <View style={styles.fontPicker}>
      {options.map((o) => (
        <TouchableOpacity
          key={o.value}
          style={[styles.fontOption, value === o.value && styles.fontOptionActive]}
          onPress={() => onChange(o.value)}
          activeOpacity={0.7}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === o.value }}
        >
          <Text
            style={[
              styles.fontOptionText,
              value === o.value && styles.fontOptionTextActive,
            ]}
          >
            {o.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const MODEL_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'claude-opus-4-7', label: 'Opus 4.7' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5' },
] as const;

const EFFORT_OPTIONS: ReadonlyArray<{ value: EffortLevel; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'X-High' },
  { value: 'max', label: 'Max' },
];

const OUTPUT_STYLE_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'concise', label: 'Concise' },
  { value: 'explanatory', label: 'Explain' },
  { value: 'learning', label: 'Learn' },
] as const;

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
    lowPowerMode,
    defaultModel,
    defaultEffortLevel,
    defaultOutputStyle,
    updateSettings,
  } = useSettingsStore(
    useShallow((s) => ({
      fontSize: s.fontSize,
      fontFamily: s.fontFamily,
      lineHeight: s.lineHeight,
      scrollbackLines: s.scrollbackLines,
      autoReconnect: s.autoReconnect,
      keepScreenOn: s.keepScreenOn,
      vibrationOnWaitingInput: s.vibrationOnWaitingInput,
      showClipboardPopupOnCopy: s.showClipboardPopupOnCopy,
      lowPowerMode: s.lowPowerMode,
      defaultModel: s.defaultModel,
      defaultEffortLevel: s.defaultEffortLevel,
      defaultOutputStyle: s.defaultOutputStyle,
      updateSettings: s.updateSettings,
    }))
  );

  const activeSessionId = useSessionsStore((s) => s.activeSessionId);
  const initMeta = useInitMetadataStore((s) =>
    activeSessionId ? s.byId[activeSessionId] ?? null : null,
  );

  const { daemonHost, daemonVersion } = useConnectionStore(
    useShallow((s) => ({
      daemonHost: s.daemonHost,
      daemonVersion: s.daemonVersion,
    }))
  );

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
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/terminal/no-session');
            }
          }}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
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

        {/* ── Claude ──────────────────────────── */}
        <SectionHeader title="Claude" />
        <View style={styles.card}>
          <Row label="Model">
            <ChipPicker
              value={defaultModel}
              options={MODEL_OPTIONS}
              onChange={(v) => updateSettings({ defaultModel: v })}
            />
          </Row>
          <Row label="Effort">
            <ChipPicker
              value={defaultEffortLevel}
              options={EFFORT_OPTIONS}
              onChange={(v) => updateSettings({ defaultEffortLevel: v })}
            />
          </Row>
          <Row label="Output Style" isLast>
            <ChipPicker
              value={defaultOutputStyle}
              options={OUTPUT_STYLE_OPTIONS}
              onChange={(v) => updateSettings({ defaultOutputStyle: v })}
            />
          </Row>
          <View style={styles.cardFooter}>
            <Text style={styles.cardFooterText}>
              Defaults applied to newly spawned sessions. Existing sessions keep the values they were spawned with.
            </Text>
          </View>
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

        {/* ── Network ─────────────────────────── */}
        <SectionHeader title="Network" />
        <View style={styles.card}>
          <ToggleRow
            label="Low-Power Mode"
            value={lowPowerMode}
            onValueChange={(v) => {
              updateSettings({ lowPowerMode: v });
              wsClient.applyLowPowerMode(v);
            }}
          />
          <View style={styles.cardFooter}>
            <Text style={styles.cardFooterText}>
              Drops the persistent notification and lets Android suspend the app in the background. You'll only get push alerts when Claude needs input — live output resumes when you reopen the app. Recommended for cellular data.
            </Text>
          </View>
        </View>

        {/* ── Session metadata (read-only from init) ───────── */}
        {initMeta && (
          <>
            {initMeta.agents.length > 0 && (
              <>
                <SectionHeader title={`Agents · ${initMeta.agents.length}`} />
                <View style={styles.card}>
                  {initMeta.agents.map((a, i) => (
                    <View
                      key={a.name}
                      style={[
                        styles.metaRow,
                        i < initMeta.agents.length - 1 && styles.rowBorder,
                      ]}
                    >
                      <Text style={styles.metaPrimary}>{a.name}</Text>
                      {a.description ? (
                        <Text style={styles.metaSecondary} numberOfLines={2}>
                          {a.description}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              </>
            )}

            {initMeta.mcpServers.length > 0 && (
              <>
                <SectionHeader title={`MCP Servers · ${initMeta.mcpServers.length}`} />
                <View style={styles.card}>
                  {initMeta.mcpServers.map((m, i) => (
                    <View
                      key={m.name}
                      style={[
                        styles.metaRow,
                        i < initMeta.mcpServers.length - 1 && styles.rowBorder,
                      ]}
                    >
                      <View style={styles.metaHead}>
                        <Text style={styles.metaPrimary}>{m.name}</Text>
                        <McpStatusPill status={m.status} />
                      </View>
                      {m.error ? (
                        <Text
                          style={[styles.metaSecondary, { color: Colors.accentRed }]}
                          numberOfLines={2}
                        >
                          {m.error}
                        </Text>
                      ) : m.serverInfo ? (
                        <Text style={styles.metaSecondary}>
                          {m.serverInfo.name} · v{m.serverInfo.version}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              </>
            )}

            {initMeta.plugins.length > 0 && (
              <>
                <SectionHeader title={`Plugins · ${initMeta.plugins.length}`} />
                <View style={styles.card}>
                  {initMeta.plugins.map((p, i) => (
                    <View
                      key={p.name}
                      style={[
                        styles.metaRow,
                        i < initMeta.plugins.length - 1 && styles.rowBorder,
                      ]}
                    >
                      <Text style={styles.metaPrimary}>{p.name}</Text>
                      <Text style={styles.metaSecondary} numberOfLines={1}>
                        {p.path}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {initMeta.skills.length > 0 && (
              <>
                <SectionHeader title={`Skills · ${initMeta.skills.length}`} />
                <View style={styles.card}>
                  <View style={styles.skillsWrap}>
                    {initMeta.skills.map((s) => (
                      <View key={s} style={styles.skillChip}>
                        <Text style={styles.skillChipText}>{s}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </>
            )}
          </>
        )}

        {activeSessionId && (
          <>
            <SectionHeader title="Memory" />
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.row}
                activeOpacity={0.7}
                onPress={() => router.push('/memory')}
                accessibilityRole="button"
                accessibilityLabel="Open memory viewer"
              >
                <Text style={styles.rowLabel}>Open Memory Viewer</Text>
                <Text style={styles.linkText}>›</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {!initMeta && activeSessionId && (
          <>
            <SectionHeader title="Session metadata" />
            <View style={styles.card}>
              <View style={styles.metaRow}>
                <Text style={styles.metaSecondary}>
                  Waiting for session init event…
                </Text>
              </View>
            </View>
          </>
        )}

        {/* ── About ───────────────────────────── */}
        <SectionHeader title="About" />
        <View style={styles.card}>
          <Row label="App Version">
            <Text style={styles.valueText}>
              {Constants.expoConfig?.version ?? '—'}
            </Text>
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
    </SafeAreaView>
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
    paddingVertical: 12,
    paddingLeft: 4,
    paddingRight: 16,
    minHeight: 44,
    minWidth: 72,
    justifyContent: 'center',
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
  cardFooter: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surfaceHigh,
  },
  cardFooterText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    lineHeight: 17,
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

  // ── Session metadata rows ─────────────────

  metaRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  metaHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  metaPrimary: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.medium,
  },
  metaSecondary: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    marginTop: 2,
  },
  mcpPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  mcpPillText: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semiBold,
    textTransform: 'lowercase',
  },
  skillsWrap: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  skillChip: {
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  skillChipText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
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
