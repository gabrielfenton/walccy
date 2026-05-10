// ──────────────────────────────────────────────
// Walccy — ClipboardHistorySheet
// Bottom sheet that lists recent clipboard entries with management
// (paste, edit & paste, pin, copy to system, delete).
// ──────────────────────────────────────────────

import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useClipboardHistoryStore, type ClipboardEntry } from '../../stores/clipboard-history.store';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../constants/typography';
import { Spacing } from '../../constants/spacing';
import { TextInputModal } from '../ui/TextInputModal';
import { SheetShell } from '../ui/SheetShell';
import { SheetHeader } from '../ui/SheetHeader';
import { SheetSearchBar } from '../ui/SheetSearchBar';
import { SheetSectionHeader } from '../ui/SheetSectionHeader';
import { ActionSheet, type ActionSheetItem } from '../ui/ActionSheet';
import { Icon } from '../ui/Icon';
import { useClipboardActions } from '../../hooks/useClipboardActions';

interface ClipboardHistorySheetProps {
  isVisible: boolean;
  onClose: () => void;
  /** Active session id — destination for the default "paste" tap. */
  activeSessionId: string | null;
}

type ListItem =
  | { kind: 'section'; id: string; title: string }
  | { kind: 'entry'; id: string; entry: ClipboardEntry };

const SOURCE_LABEL: Record<ClipboardEntry['source'], string> = {
  system:   'System',
  terminal: 'Terminal',
  manual:   'Saved',
};

function relativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

function lineCount(s: string): number {
  if (!s) return 0;
  return s.split('\n').length;
}

/** Action menu state — null = closed; otherwise either a top-level entry menu
 * or a session-target picker. */
type MenuState =
  | { kind: 'entry'; entry: ClipboardEntry }
  | { kind: 'targets'; entry: ClipboardEntry }
  | null;

export function ClipboardHistorySheet({
  isVisible,
  onClose,
  activeSessionId,
}: ClipboardHistorySheetProps): React.ReactElement {
  const { entries, togglePin, remove, clearUnpinned, updateContent } =
    useClipboardHistoryStore(
      useShallow((s) => ({
        entries: s.entries,
        togglePin: s.togglePin,
        remove: s.remove,
        clearUnpinned: s.clearUnpinned,
        updateContent: s.updateContent,
      })),
    );

  const { pasteToTargets, copyToSystem, ownedTargets } =
    useClipboardActions(activeSessionId);

  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<ClipboardEntry | null>(null);
  const [pendingPaste, setPendingPaste] = useState<{
    entry: ClipboardEntry;
    targetIds: string[];
  } | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // Reset transient state on close
  useEffect(() => {
    if (!isVisible) {
      setQuery('');
      setEditing(null);
      setPendingPaste(null);
      setMenu(null);
      setConfirmClear(false);
    }
  }, [isVisible]);

  // ── Paste flow ────────────────────────────────

  const performPaste = useCallback(
    (content: string, targetIds: string[]) => {
      pasteToTargets(content, targetIds);
      onClose();
    },
    [pasteToTargets, onClose],
  );

  const handlePaste = useCallback(
    (entry: ClipboardEntry, targetIds: string[]) => {
      const lines = lineCount(entry.content);
      if (lines > 1) {
        // Multi-line paste warning — terminal will receive each \n as a key.
        setPendingPaste({ entry, targetIds });
        return;
      }
      performPaste(entry.content, targetIds);
    },
    [performPaste],
  );

  const handleEntryTap = useCallback(
    (entry: ClipboardEntry) => {
      if (!activeSessionId) {
        Alert.alert('No active session', 'Open a session first to paste here.');
        return;
      }
      handlePaste(entry, [activeSessionId]);
    },
    [activeSessionId, handlePaste],
  );

  const handleEntryLongPress = useCallback(
    (entry: ClipboardEntry) => {
      setMenu({ kind: 'entry', entry });
    },
    [],
  );

  // ── Edit & paste ──────────────────────────────

  const handleEditSubmit = useCallback(
    (newContent: string) => {
      if (!editing) return;
      updateContent(editing.id, newContent);
      const targetIds = activeSessionId ? [activeSessionId] : [];
      const updated = { ...editing, content: newContent };
      setEditing(null);
      if (targetIds.length > 0 && newContent.trim().length > 0) {
        handlePaste(updated, targetIds);
      }
    },
    [editing, updateContent, activeSessionId, handlePaste],
  );

  // ── Filter + group ────────────────────────────

  const listData: ListItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? entries.filter((e) => e.content.toLowerCase().includes(q))
      : entries;

    const items: ListItem[] = [];
    const pinned = filtered.filter((e) => e.pinned);
    const recent = filtered.filter((e) => !e.pinned);

    if (pinned.length > 0) {
      items.push({ kind: 'section', id: 'sec-pinned', title: 'Pinned' });
      pinned.forEach((e) => items.push({ kind: 'entry', id: e.id, entry: e }));
    }
    if (recent.length > 0) {
      items.push({ kind: 'section', id: 'sec-recent', title: 'Recent' });
      recent.forEach((e) => items.push({ kind: 'entry', id: e.id, entry: e }));
    }
    return items;
  }, [entries, query]);

  // ── Render rows ───────────────────────────────

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.kind === 'section') {
        return <SheetSectionHeader title={item.title} />;
      }

      const e = item.entry;
      const lines = lineCount(e.content);
      const previewLines = e.content.split('\n').slice(0, 2);
      const preview = previewLines.join('\n');

      return (
        <TouchableOpacity
          style={styles.row}
          onPress={() => handleEntryTap(e)}
          onLongPress={() => handleEntryLongPress(e)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Paste clipboard entry: ${preview.slice(0, 80)}`}
        >
          <View style={styles.rowText}>
            <Text style={styles.rowPreview} numberOfLines={2}>
              {preview}
              {previewLines.length < lines ? '\n…' : ''}
            </Text>
            <View style={styles.rowMeta}>
              {e.pinned ? (
                <Icon
                  name="bookmark"
                  size={11}
                  color={Colors.accent}
                  style={styles.metaPinIcon}
                />
              ) : null}
              <Text style={styles.metaSource}>{SOURCE_LABEL[e.source]}</Text>
              <Text style={styles.metaDot}>·</Text>
              <Text style={styles.metaTime}>{relativeTime(e.addedAt)}</Text>
              {lines > 1 ? (
                <>
                  <Text style={styles.metaDot}>·</Text>
                  <Text style={styles.metaLines}>{lines} lines</Text>
                </>
              ) : null}
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [handleEntryTap, handleEntryLongPress],
  );

  const keyExtractor = useCallback((item: ListItem) => item.id, []);

  // ── Empty state ───────────────────────────────

  const ListEmpty = useMemo(
    () => (
      <View style={styles.emptyState}>
        <View style={styles.emptyIconCircle}>
          <Icon name="clipboard" size={20} color={Colors.accent} />
        </View>
        <Text style={styles.emptyText}>No clipboard history yet</Text>
        <Text style={styles.emptySubtext}>
          Anything you copy on this device — system-wide or from terminal output — shows up here.
        </Text>
      </View>
    ),
    [],
  );

  // ── Action sheet items ────────────────────────

  const entryMenuItems: ActionSheetItem[] = useMemo(() => {
    if (menu?.kind !== 'entry') return [];
    const entry = menu.entry;
    const showTargetPicker = ownedTargets.length > 1;

    const items: ActionSheetItem[] = [
      {
        label: 'Edit & paste…',
        iconName: 'edit-3',
        onPress: () => setEditing(entry),
      },
    ];
    if (showTargetPicker) {
      items.push({
        label: 'Paste to…',
        iconName: 'send',
        onPress: () => setMenu({ kind: 'targets', entry }),
      });
    }
    items.push({
      label: entry.pinned ? 'Unpin' : 'Pin',
      iconName: 'bookmark',
      onPress: () => togglePin(entry.id),
    });
    items.push({
      label: 'Copy to system',
      iconName: 'copy',
      onPress: () => {
        void copyToSystem(entry.content);
      },
    });
    items.push({
      label: 'Delete',
      style: 'destructive',
      iconName: 'trash-2',
      onPress: () => remove(entry.id),
    });
    return items;
  }, [menu, ownedTargets.length, togglePin, copyToSystem, remove]);

  const targetMenuItems: ActionSheetItem[] = useMemo(() => {
    if (menu?.kind !== 'targets') return [];
    const entry = menu.entry;
    const items: ActionSheetItem[] = ownedTargets.map((t) => ({
      label: t.name,
      iconName: 'terminal',
      onPress: () => handlePaste(entry, [t.id]),
    }));
    items.push({
      label: 'All sessions',
      style: 'primary',
      iconName: 'send',
      onPress: () => handlePaste(entry, ownedTargets.map((t) => t.id)),
    });
    return items;
  }, [menu, ownedTargets, handlePaste]);

  const previewForMenu = useCallback((entry: ClipboardEntry): string => {
    const flat = entry.content.replace(/\n/g, ' ');
    return flat.length > 60 ? flat.slice(0, 60) + '…' : flat;
  }, []);

  // ── Render ────────────────────────────────────

  const headerTrailing = useMemo(() => {
    return entries.some((e) => !e.pinned)
      ? { label: 'Clear', onPress: () => setConfirmClear(true) }
      : { label: 'Done', onPress: onClose, primary: true };
  }, [entries, onClose]);

  return (
    <>
      <SheetShell isVisible={isVisible} onClose={onClose}>
        <SheetHeader title="Clipboard" trailingAction={headerTrailing} />

        <SheetSearchBar
          value={query}
          onChangeText={setQuery}
          placeholder="Search clipboard…"
        />

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

        <TextInputModal
          visible={editing !== null}
          title="Edit & paste"
          message="Tweak the text before sending it to the active terminal."
          defaultValue={editing?.content ?? ''}
          onSubmit={handleEditSubmit}
          onCancel={() => setEditing(null)}
        />
      </SheetShell>

      {/* Entry-level action menu (long-press) */}
      <ActionSheet
        isVisible={menu?.kind === 'entry'}
        onClose={() => setMenu(null)}
        title={menu?.kind === 'entry' ? previewForMenu(menu.entry) : undefined}
        actions={entryMenuItems}
      />

      {/* Target picker (after "Paste to…") */}
      <ActionSheet
        isVisible={menu?.kind === 'targets'}
        onClose={() => setMenu(null)}
        title="Paste to"
        actions={targetMenuItems}
      />

      {/* Multi-line paste confirmation */}
      <ActionSheet
        isVisible={pendingPaste !== null}
        onClose={() => setPendingPaste(null)}
        title="Send multi-line paste?"
        message={
          pendingPaste
            ? `${lineCount(pendingPaste.entry.content)} lines will be sent — each newline behaves like pressing Enter.`
            : undefined
        }
        actions={
          pendingPaste
            ? [
                {
                  label: 'Send',
                  style: 'destructive',
                  iconName: 'send',
                  onPress: () => {
                    const { entry, targetIds } = pendingPaste;
                    setPendingPaste(null);
                    performPaste(entry.content, targetIds);
                  },
                },
              ]
            : []
        }
      />

      {/* Clear-unpinned confirmation */}
      <ActionSheet
        isVisible={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear unpinned"
        message="Remove all unpinned clipboard entries?"
        actions={[
          {
            label: 'Clear',
            style: 'destructive',
            iconName: 'trash-2',
            onPress: clearUnpinned,
          },
        ]}
      />
    </>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  listEmpty: {
    flex: 1,
  },

  row: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  rowText: {
    flex: 1,
  },
  rowPreview: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body,
    lineHeight: 20,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 6,
  },
  metaPinIcon: {
    marginRight: 2,
  },
  metaSource: {
    color: Colors.accent,
    fontFamily: FontFamily.ui,
    fontSize: 11,
    fontWeight: FontWeight.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metaDot: {
    color: Colors.textSecondary,
    fontSize: 11,
  },
  metaTime: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: 11,
  },
  metaLines: {
    color: Colors.accentAmber,
    fontFamily: FontFamily.ui,
    fontSize: 11,
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
    backgroundColor: Colors.surfaceHigh,
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
    lineHeight: 18,
  },
});
