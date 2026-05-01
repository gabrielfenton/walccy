// ──────────────────────────────────────────────
// Walccy — NewSessionSheet
// Bottom sheet for spawning a new claude session.
// Lets the user pick a working directory from:
//   • Recent (cwds of currently active sessions)
//   • Git repos discovered on the host
//   • Home (~)
//   • Or type a custom absolute path
// ──────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { wsClient } from '../../services/ws-client';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../constants/typography';
import { Spacing } from '../../constants/spacing';
import type { DirectoryEntry } from '@walccy/protocol';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.78;

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

const KIND_ICON: Record<DirectoryEntry['kind'], string> = {
  recent: '◷',
  git:    '⎇',
  home:   '⌂',
  custom: '✎',
};

export function NewSessionSheet({
  isVisible,
  onClose,
  onSpawned,
}: NewSessionSheetProps): React.ReactElement {
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;

  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spawningPath, setSpawningPath] = useState<string | null>(null);

  // ── Slide animation ───────────────────────────

  useEffect(() => {
    if (isVisible) {
      Animated.spring(translateY, {
        toValue: 0,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: SHEET_HEIGHT,
        duration: 220,
        useNativeDriver: true,
      }).start();
      // Reset state on close
      setQuery('');
      setError(null);
      setSpawningPath(null);
    }
  }, [isVisible, translateY]);

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

  // ── Spawn ─────────────────────────────────────

  const handleSpawn = useCallback(
    async (rawPath: string) => {
      const path = rawPath.trim();
      if (!path) return;
      setSpawningPath(path);
      setError(null);
      try {
        const sessionId = await wsClient.spawnSession(path);
        onSpawned(sessionId);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setSpawningPath(null);
      }
    },
    [onSpawned, onClose]
  );

  // ── Filter + group ────────────────────────────

  const listData: ListItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? entries.filter(
          (e) =>
            e.path.toLowerCase().includes(q) ||
            e.label.toLowerCase().includes(q)
        )
      : entries;

    // Group by kind, preserving section order: recent → git → home
    const order: DirectoryEntry['kind'][] = ['recent', 'git', 'home'];
    const items: ListItem[] = [];

    // Custom path row at the top — only when user has typed something
    // that looks like an absolute path or starts with `~`.
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
        return (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>{item.title}</Text>
          </View>
        );
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
            <Text style={styles.rowIcon}>{KIND_ICON.custom}</Text>
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
          <Text style={styles.rowIcon}>{KIND_ICON[e.kind]}</Text>
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
    [handleSpawn, spawningPath]
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
          <Text style={styles.emptyIcon}>⚠</Text>
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
        <Text style={styles.emptyIcon}>🔍</Text>
        <Text style={styles.emptyText}>No matches</Text>
        <Text style={styles.emptySubtext}>
          Type an absolute path (starts with / or ~) to use it directly.
        </Text>
      </View>
    );
  }, [loading, error, fetchDirectories]);

  // ── Render ────────────────────────────────────

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <TouchableWithoutFeedback
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
      >
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <KeyboardAvoidingView
          style={styles.sheetInner}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.handleBar} />

          <View style={styles.header}>
            <Text style={styles.headerTitle}>New Session</Text>
            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.cancelButton}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.searchBarWrap}>
            <Text style={styles.searchIcon}>⌕</Text>
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search or type a path…"
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              returnKeyType="go"
              onSubmitEditing={() => {
                const p = query.trim();
                if (p && (p.startsWith('/') || p.startsWith('~'))) {
                  void handleSpawn(p);
                }
              }}
              accessibilityLabel="Search directories"
            />
            {query.length > 0 ? (
              <TouchableOpacity
                onPress={() => setQuery('')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Text style={styles.clearButton}>✕</Text>
              </TouchableOpacity>
            ) : null}
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
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: SHEET_HEIGHT,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  sheetInner: {
    flex: 1,
  },
  handleBar: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    marginTop: 8,
    marginBottom: 4,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  headerTitle: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: 18,
    fontWeight: FontWeight.bold,
  },
  cancelButton: {
    color: Colors.accent,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.medium,
  },

  searchBarWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
    height: 40,
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 10,
    gap: Spacing.sm,
  },
  searchIcon: {
    color: Colors.textSecondary,
    fontSize: 16,
  },
  searchInput: {
    flex: 1,
    color: Colors.textPrimary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body,
    padding: 0,
  },
  clearButton: {
    color: Colors.textSecondary,
    fontSize: 14,
    paddingHorizontal: 4,
  },

  errorBanner: {
    backgroundColor: Colors.accentRed + '22',
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

  sectionHeader: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  sectionHeaderText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: 11,
    fontWeight: FontWeight.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
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
  rowIcon: {
    width: 24,
    color: Colors.accent,
    fontSize: 18,
    textAlign: 'center',
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
  emptyIcon: {
    fontSize: 36,
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
