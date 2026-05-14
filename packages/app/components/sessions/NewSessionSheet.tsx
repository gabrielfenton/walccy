// ──────────────────────────────────────────────
// Walccy — NewSessionSheet
// Bottom sheet for spawning a new claude session.
// Lets the user pick a working directory from:
//   • Recent (cwds of currently active sessions)
//   • Git repos discovered on the host
//   • Home (~)
//   • Or type a custom absolute path
// ──────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { wsClient } from '../../services/ws-client';
import { WInput } from '../ui/WInput';
import { useSettingsStore } from '../../stores/settings.store';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../constants/typography';
import { Spacing } from '../../constants/spacing';
import { Tint } from '../../constants/tint';
import { SheetShell } from '../ui/SheetShell';
import { SheetHeader } from '../ui/SheetHeader';
import { SheetSearchBar } from '../ui/SheetSearchBar';
import { SheetSectionHeader } from '../ui/SheetSectionHeader';
import { Icon, type FeatherIconName } from '../ui/Icon';
import type { DirectoryEntry, TranscriptEntry } from '@walccy/protocol';

interface NewSessionSheetProps {
  isVisible: boolean;
  onClose: () => void;
  /** Called with the new session id once spawn succeeds. */
  onSpawned: (sessionId: string) => void;
}

type ListItem =
  | { kind: 'section'; id: string; title: string }
  | { kind: 'entry'; id: string; entry: DirectoryEntry }
  | { kind: 'custom'; id: string; path: string };

const SECTION_LABEL: Record<DirectoryEntry['kind'], string> = {
  recent: 'Recent',
  git:    'Git repos',
  home:   'Home',
  custom: 'Custom',
};

const KIND_ICON: Record<DirectoryEntry['kind'], FeatherIconName> = {
  recent: 'clock',
  git:    'git-branch',
  home:   'home',
  custom: 'edit-3',
};

export function NewSessionSheet({
  isVisible,
  onClose,
  onSpawned,
}: NewSessionSheetProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spawningPath, setSpawningPath] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [worktreeEnabled, setWorktreeEnabled] = useState(false);
  const [worktreeName, setWorktreeName] = useState('');
  const [resumeSessionId, setResumeSessionId] = useState('');
  // Resume-picker state: the cwd we're listing transcripts for, plus the
  // results.  Driven by the search field — typing `/abs/path` or `~/foo`
  // triggers a debounced LIST_TRANSCRIPTS request so the user sees their
  // prior laptop/phone sessions for that cwd and can pick one.
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [transcriptCwd, setTranscriptCwd] = useState<string | null>(null);
  const [transcriptsLoading, setTranscriptsLoading] = useState(false);

  // Reset transient state when the sheet closes
  useEffect(() => {
    if (!isVisible) {
      setQuery('');
      setError(null);
      setSpawningPath(null);
      setAdvancedOpen(false);
      setWorktreeEnabled(false);
      setWorktreeName('');
      setResumeSessionId('');
      setTranscripts([]);
      setTranscriptCwd(null);
      setTranscriptsLoading(false);
    }
  }, [isVisible]);

  // ── Fetch directories when opened ─────────────

  const fetchDirectories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await wsClient.listDirectories();
      setEntries(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isVisible) {
      void fetchDirectories();
    }
  }, [isVisible, fetchDirectories]);

  // ── Fetch transcripts when query looks like a path ──
  //
  // Debounce 300ms — typing in the search bar shouldn't fire a request
  // per keystroke.  Only triggers when Advanced is open AND the query
  // starts with `/` or `~/` (the same heuristic the entry list uses to
  // surface a "use this path" custom row).
  useEffect(() => {
    if (!isVisible || !advancedOpen) {
      setTranscripts([]);
      setTranscriptCwd(null);
      return;
    }
    const trimmed = query.trim();
    const looksLikePath = trimmed.startsWith('/') || trimmed.startsWith('~');
    if (!looksLikePath || trimmed.length < 2) {
      setTranscripts([]);
      setTranscriptCwd(null);
      return;
    }
    const cwd = trimmed.startsWith('~')
      ? trimmed.replace(/^~/, process.env['HOME'] ?? '~')
      : trimmed;
    let cancelled = false;
    setTranscriptsLoading(true);
    const t = setTimeout(async () => {
      try {
        const reply = await wsClient.listTranscripts(cwd, 20);
        if (cancelled) return;
        if (reply.error) {
          setTranscripts([]);
        } else {
          setTranscripts(reply.entries);
        }
        setTranscriptCwd(cwd);
      } catch {
        if (!cancelled) {
          setTranscripts([]);
          setTranscriptCwd(cwd);
        }
      } finally {
        if (!cancelled) setTranscriptsLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [isVisible, advancedOpen, query]);

  // ── Spawn ─────────────────────────────────────

  const handleSpawn = useCallback(
    async (rawPath: string) => {
      const path = rawPath.trim();
      if (!path) return;
      setSpawningPath(path);
      setError(null);
      try {
        const { defaultModel, defaultEffortLevel, defaultOutputStyle } =
          useSettingsStore.getState();
        const trimmedWorktree = worktreeName.trim();
        const trimmedResume = resumeSessionId.trim();
        const worktreeValue: string | boolean | undefined = !worktreeEnabled
          ? undefined
          : trimmedWorktree.length > 0
            ? trimmedWorktree
            : true;
        const sessionId = await wsClient.spawnSession(path, {
          ...(defaultModel ? { model: defaultModel } : {}),
          effortLevel: defaultEffortLevel,
          outputStyle: defaultOutputStyle,
          ...(worktreeValue !== undefined ? { worktree: worktreeValue } : {}),
          ...(trimmedResume ? { resumeSessionId: trimmedResume } : {}),
        });
        onSpawned(sessionId);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setSpawningPath(null);
      }
    },
    [onSpawned, onClose, worktreeEnabled, worktreeName, resumeSessionId],
  );

  // ── Filter + group ────────────────────────────

  const listData: ListItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? entries.filter(
          (e) =>
            e.path.toLowerCase().includes(q) ||
            e.label.toLowerCase().includes(q),
        )
      : entries;

    const order: DirectoryEntry['kind'][] = ['recent', 'git', 'home'];
    const items: ListItem[] = [];

    if (q.startsWith('/') || q.startsWith('~')) {
      items.push({ kind: 'section', id: 'sec-custom', title: 'Use this path' });
      items.push({ kind: 'custom', id: 'custom', path: query.trim() });
    }

    for (const k of order) {
      const group = filtered.filter((e) => e.kind === k);
      if (group.length === 0) continue;
      items.push({ kind: 'section', id: `sec-${k}`, title: SECTION_LABEL[k] });
      for (const e of group) {
        items.push({ kind: 'entry', id: e.path, entry: e });
      }
    }

    return items;
  }, [entries, query]);

  // ── Render helpers ────────────────────────────

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.kind === 'section') {
        return <SheetSectionHeader title={item.title} />;
      }

      if (item.kind === 'custom') {
        const isSpawning = spawningPath === item.path;
        return (
          <TouchableOpacity
            style={styles.row}
            onPress={() => handleSpawn(item.path)}
            disabled={spawningPath !== null}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Spawn session at ${item.path}`}
          >
            <View style={styles.rowIconWrap}>
              <Icon name={KIND_ICON.custom} size={18} color={Colors.accent} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel} numberOfLines={1}>
                {item.path}
              </Text>
              <Text style={styles.rowDetail}>Custom path</Text>
            </View>
            {isSpawning ? <ActivityIndicator color={Colors.accent} /> : null}
          </TouchableOpacity>
        );
      }

      const e = item.entry;
      const isSpawning = spawningPath === e.path;
      return (
        <TouchableOpacity
          style={styles.row}
          onPress={() => handleSpawn(e.path)}
          disabled={spawningPath !== null}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Spawn session at ${e.path}`}
        >
          <View style={styles.rowIconWrap}>
            <Icon name={KIND_ICON[e.kind]} size={18} color={Colors.accent} />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel} numberOfLines={1}>
              {e.label}
            </Text>
            <Text style={styles.rowDetail} numberOfLines={1}>
              {e.detail ?? e.path}
            </Text>
          </View>
          {isSpawning ? <ActivityIndicator color={Colors.accent} /> : null}
        </TouchableOpacity>
      );
    },
    [handleSpawn, spawningPath],
  );

  const keyExtractor = useCallback((item: ListItem) => item.id, []);

  // ── Empty state ───────────────────────────────

  const ListEmpty = useMemo(() => {
    if (loading) {
      return (
        <View style={styles.emptyState}>
          <ActivityIndicator color={Colors.accent} />
          <Text style={styles.emptySubtext}>Looking for projects…</Text>
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.emptyState}>
          <View style={styles.emptyIconCircle}>
            <Icon name="alert-triangle" size={20} color={Colors.accentRed} />
          </View>
          <Text style={styles.emptyText}>Couldn't load directories</Text>
          <Text style={styles.emptySubtext}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={fetchDirectories}
            activeOpacity={0.75}
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.emptyState}>
        <View style={styles.emptyIconCircle}>
          <Icon name="search" size={20} color={Colors.accent} />
        </View>
        <Text style={styles.emptyText}>No matches</Text>
        <Text style={styles.emptySubtext}>
          Type an absolute path (starts with / or ~) to use it directly.
        </Text>
      </View>
    );
  }, [loading, error, fetchDirectories]);

  // ── Render ────────────────────────────────────

  return (
    <SheetShell isVisible={isVisible} onClose={onClose}>
      <SheetHeader
        title="New Session"
        trailingAction={{ label: 'Cancel', onPress: onClose }}
      />

      <SheetSearchBar
        value={query}
        onChangeText={setQuery}
        placeholder="Search or type a path…"
        monospace
        onSubmit={() => {
          const p = query.trim();
          if (p && (p.startsWith('/') || p.startsWith('~'))) {
            void handleSpawn(p);
          }
        }}
      />

      <View style={styles.advanced}>
        <TouchableOpacity
          onPress={() => setAdvancedOpen((v) => !v)}
          activeOpacity={0.75}
          style={styles.advancedToggle}
          accessibilityRole="button"
          accessibilityLabel="Advanced spawn options"
          accessibilityState={{ expanded: advancedOpen }}
        >
          <Text style={styles.advancedToggleText}>
            {advancedOpen ? '▾' : '▸'} Advanced
          </Text>
          {(worktreeEnabled || resumeSessionId.trim().length > 0) && (
            <View style={styles.advancedDot} />
          )}
        </TouchableOpacity>

        {advancedOpen && (
          <View style={styles.advancedBody}>
            <View style={styles.advancedRow}>
              <TouchableOpacity
                onPress={() => setWorktreeEnabled((v) => !v)}
                activeOpacity={0.75}
                style={styles.checkbox}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: worktreeEnabled }}
                accessibilityLabel="Spawn in a worktree"
              >
                <View
                  style={[
                    styles.checkboxBox,
                    worktreeEnabled && styles.checkboxBoxOn,
                  ]}
                >
                  {worktreeEnabled && (
                    <Text style={styles.checkboxGlyph}>✓</Text>
                  )}
                </View>
                <Text style={styles.checkboxLabel}>Worktree</Text>
              </TouchableOpacity>
              <WInput
                variant="short"
                monospace
                containerStyle={styles.advancedInputWrap}
                inputStyle={[
                  styles.advancedInput,
                  !worktreeEnabled && styles.advancedInputDisabled,
                ]}
                value={worktreeName}
                onChangeText={setWorktreeName}
                editable={worktreeEnabled}
                placeholder="branch / name (optional)"
              />
            </View>

            {transcriptCwd && (
              <View style={styles.transcriptSection}>
                <Text style={styles.transcriptHeader} numberOfLines={1}>
                  Resume from {transcriptCwd}
                </Text>
                {transcriptsLoading && transcripts.length === 0 ? (
                  <View style={styles.transcriptLoading}>
                    <ActivityIndicator color={Colors.accent} />
                  </View>
                ) : transcripts.length === 0 ? (
                  <Text style={styles.transcriptEmpty}>
                    No prior sessions in this directory.
                  </Text>
                ) : (
                  transcripts.slice(0, 5).map((t) => {
                    const selected = resumeSessionId === t.sessionId;
                    const disabled = t.isLive;
                    const idShort = t.sessionId.slice(0, 8);
                    return (
                      <TouchableOpacity
                        key={t.sessionId}
                        style={[
                          styles.transcriptRow,
                          selected && styles.transcriptRowSelected,
                          disabled && styles.transcriptRowDisabled,
                        ]}
                        activeOpacity={0.7}
                        disabled={disabled}
                        onPress={() =>
                          setResumeSessionId(
                            selected ? '' : t.sessionId,
                          )
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Resume session ${idShort}`}
                        accessibilityState={{ selected, disabled }}
                      >
                        <View style={styles.transcriptRowMain}>
                          <Text
                            style={styles.transcriptPreview}
                            numberOfLines={1}
                          >
                            {t.preview ?? '(no preview available)'}
                          </Text>
                          <Text style={styles.transcriptMeta} numberOfLines={1}>
                            {formatRelativeTime(t.modifiedAt)}
                            {' · '}
                            {t.messageCount} msgs
                            {' · '}
                            {idShort}…
                          </Text>
                        </View>
                        {disabled && (
                          <Text style={styles.transcriptLiveTag}>running</Text>
                        )}
                        {selected && !disabled && (
                          <Text style={styles.transcriptSelectedTag}>✓</Text>
                        )}
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            )}

            <View style={styles.advancedRow}>
              <Text style={styles.advancedLabel}>Resume</Text>
              <WInput
                variant="short"
                monospace
                containerStyle={styles.advancedInputWrap}
                inputStyle={styles.advancedInput}
                value={resumeSessionId}
                onChangeText={setResumeSessionId}
                placeholder="prior session id (optional)"
              />
            </View>
          </View>
        )}
      </View>

      {error && spawningPath === null ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={listData}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListEmptyComponent={ListEmpty}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.list}
        contentContainerStyle={listData.length === 0 ? styles.listEmpty : undefined}
      />
    </SheetShell>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

function formatRelativeTime(mtimeMs: number): string {
  const deltaSec = Math.max(0, (Date.now() - mtimeMs) / 1000);
  if (deltaSec < 60) return 'just now';
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  if (deltaSec < 86400 * 7) return `${Math.floor(deltaSec / 86400)}d ago`;
  return new Date(mtimeMs).toLocaleDateString();
}

const styles = StyleSheet.create({
  advanced: {
    paddingHorizontal: Spacing.lg,
    paddingTop: 4,
    paddingBottom: 6,
  },
  transcriptSection: {
    marginBottom: 10,
    paddingTop: 4,
  },
  transcriptHeader: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.medium,
    marginBottom: 6,
  },
  transcriptLoading: {
    paddingVertical: 8,
    alignItems: 'flex-start',
  },
  transcriptEmpty: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    paddingVertical: 4,
  },
  transcriptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.surfaceHigh,
    marginBottom: 4,
    gap: 8,
  },
  transcriptRowSelected: {
    borderWidth: 1,
    borderColor: Colors.accent,
    backgroundColor: Colors.accent + '22',
  },
  transcriptRowDisabled: {
    opacity: 0.5,
  },
  transcriptRowMain: {
    flex: 1,
  },
  transcriptPreview: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    marginBottom: 2,
  },
  transcriptMeta: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption - 1,
  },
  transcriptLiveTag: {
    color: Colors.accentAmber,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption - 1,
    fontWeight: FontWeight.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  transcriptSelectedTag: {
    color: Colors.accent,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.semiBold,
  },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 6,
  },
  advancedToggleText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  advancedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.accent,
  },
  advancedBody: {
    paddingTop: 4,
    gap: 8,
  },
  advancedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  advancedLabel: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.medium,
    width: 86,
  },
  advancedInputWrap: {
    flex: 1,
  },
  advancedInput: {
    flex: 1,
    // Override WInput's `short` 44pt minHeight — these are compact mono
    // fields, sized by their own padding + caption font.
    minHeight: 0,
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: Colors.textPrimary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
  },
  advancedInputDisabled: {
    opacity: 0.4,
  },
  checkbox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: 86,
  },
  checkboxBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  checkboxBoxOn: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accent + '33',
  },
  checkboxGlyph: {
    color: Colors.accent,
    fontFamily: FontFamily.ui,
    fontSize: 12,
    fontWeight: FontWeight.semiBold,
  },
  checkboxLabel: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.medium,
  },

  errorBanner: {
    backgroundColor: Tint.dangerWeak,
    borderLeftWidth: 3,
    borderLeftColor: Colors.accentRed,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    borderRadius: 6,
  },
  errorBannerText: {
    color: Colors.accentRed,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
  },

  list: {
    flex: 1,
  },
  listEmpty: {
    flex: 1,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  rowIconWrap: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.medium,
  },
  rowDetail: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
    marginTop: 2,
  },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxxl,
    gap: Spacing.sm,
  },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Tint.accentWeak,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  emptyText: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.semiBold,
  },
  emptySubtext: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.accent,
    borderRadius: 8,
  },
  retryText: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.semiBold,
  },
});
