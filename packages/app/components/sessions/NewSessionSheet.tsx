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
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../constants/typography';
import { Spacing } from '../../constants/spacing';
import { Tint } from '../../constants/tint';
import { SheetShell } from '../ui/SheetShell';
import { SheetHeader } from '../ui/SheetHeader';
import { SheetSearchBar } from '../ui/SheetSearchBar';
import { SheetSectionHeader } from '../ui/SheetSectionHeader';
import { Icon, type FeatherIconName } from '../ui/Icon';
import type { DirectoryEntry } from '@walccy/protocol';

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

  // Reset transient state when the sheet closes
  useEffect(() => {
    if (!isVisible) {
      setQuery('');
      setError(null);
      setSpawningPath(null);
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
    [onSpawned, onClose],
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

const styles = StyleSheet.create({
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
