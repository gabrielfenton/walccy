// ──────────────────────────────────────────────
// Walccy — PromptLibrarySheet
// Bottom sheet modal for browsing and using saved prompts.
// ──────────────────────────────────────────────

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Alert,
  FlatList,
  Keyboard,
  StyleSheet,
  Text,
  type TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { TextInputModal } from '../ui/TextInputModal';
import { WInput } from '../ui/WInput';
import { usePromptLibraryStore } from '../../stores/prompt-library.store';
import type { Prompt } from '../../stores/prompt-library.store';
import {
  useClipboardHistoryStore,
  type ClipboardEntry,
} from '../../stores/clipboard-history.store';
import { useComposerDraftStore } from '../../stores/composer-draft.store';
import { wsClient } from '../../services/ws-client';
import * as Clipboard from 'expo-clipboard';
import { PromptSearchBar } from './PromptSearchBar';
import { PromptItem } from './PromptItem';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../constants/typography';
import { Spacing } from '../../constants/spacing';
import { SheetShell } from '../ui/SheetShell';
import { SheetHeader } from '../ui/SheetHeader';
import { SheetSectionHeader } from '../ui/SheetSectionHeader';
import { ActionSheet, type ActionSheetItem } from '../ui/ActionSheet';
import { Icon } from '../ui/Icon';

// ──────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────

interface PromptLibrarySheetProps {
  isVisible: boolean;
  onClose: () => void;
  /** Active session — destination for paste / send-now. */
  activeSessionId: string | null;
}

const MAX_CLIPBOARD_IN_BOARD = 10;

function clipboardPreview(s: string): string {
  const flat = s.replace(/\n/g, ' ');
  return flat.length > 80 ? flat.slice(0, 80) + '…' : flat;
}

// ──────────────────────────────────────────────
// New Prompt Inline Form
// ──────────────────────────────────────────────

interface NewPromptFormProps {
  onSave: (title: string, content: string) => void;
  onCancel: () => void;
}

function NewPromptForm({ onSave, onCancel }: NewPromptFormProps): React.ReactElement {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const contentRef = useRef<TextInput>(null);

  const handleSave = () => {
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    if (!trimmedTitle) {
      Alert.alert('Title required', 'Please enter a title for this prompt.');
      return;
    }
    onSave(trimmedTitle, trimmedContent);
  };

  return (
    <View style={formStyles.container}>
      <WInput
        variant="bare"
        inputStyle={formStyles.titleInput}
        value={title}
        onChangeText={setTitle}
        placeholder="Prompt title (required)"
        autoCapitalize="sentences"
        autoFocus
        returnKeyType="next"
        onSubmitEditing={() => contentRef.current?.focus()}
        blurOnSubmit={false}
        accessibilityLabel="Prompt title"
      />
      <WInput
        ref={contentRef}
        variant="long"
        maxHeight={220}
        inputStyle={formStyles.contentInput}
        value={content}
        onChangeText={setContent}
        placeholder="Prompt content…"
        numberOfLines={4}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Prompt content"
      />
      <View style={formStyles.actions}>
        <TouchableOpacity
          style={formStyles.cancelButton}
          onPress={onCancel}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Text style={formStyles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={formStyles.saveButton}
          onPress={handleSave}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Save prompt"
        >
          <Text style={formStyles.saveText}>Save</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const formStyles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surfaceHigh,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    borderRadius: 8,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  titleInput: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingVertical: Spacing.sm,
    paddingHorizontal: 0,
  },
  contentInput: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    // Match lineHeight to this field's own fontSize — WInput's `long`
    // variant sets it for FontSize.input, which is a touch too large here.
    lineHeight: FontSize.body * 1.4,
    minHeight: 88,
    paddingVertical: Spacing.sm,
    paddingHorizontal: 0,
    // The form card already provides the surfaceHigh background — strip
    // WInput's `long` box decoration so it doesn't nest a second box.
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  cancelButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
  },
  saveButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: 6,
    backgroundColor: Colors.accent,
  },
  saveText: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.semiBold,
  },
});

// ──────────────────────────────────────────────
// List item types for FlatList data
// ──────────────────────────────────────────────

type ListItem =
  | { kind: 'section'; id: string; title: string }
  | { kind: 'prompt'; id: string; prompt: Prompt }
  | { kind: 'clipboard'; id: string; entry: ClipboardEntry };

type RowMenu =
  | { kind: 'prompt'; prompt: Prompt }
  | { kind: 'clipboard'; entry: ClipboardEntry }
  | null;

// ──────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────

export function PromptLibrarySheet({
  isVisible,
  onClose,
  activeSessionId,
}: PromptLibrarySheetProps): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [rowMenu, setRowMenu] = useState<RowMenu>(null);
  const [confirmDelete, setConfirmDelete] = useState<Prompt | null>(null);
  const [savingClipboardAsSnippet, setSavingClipboardAsSnippet] =
    useState<ClipboardEntry | null>(null);

  const {
    prompts,
    addPrompt,
    updatePrompt,
    deletePrompt,
    recordUse,
    searchPrompts,
    getPinned,
    getRecent,
  } = usePromptLibraryStore(
    useShallow((s) => ({
      prompts: s.prompts,
      addPrompt: s.addPrompt,
      updatePrompt: s.updatePrompt,
      deletePrompt: s.deletePrompt,
      recordUse: s.recordUse,
      searchPrompts: s.searchPrompts,
      getPinned: s.getPinned,
      getRecent: s.getRecent,
    })),
  );

  const {
    clipboardEntries,
    togglePinClipboard,
    removeClipboard,
  } = useClipboardHistoryStore(
    useShallow((s) => ({
      clipboardEntries: s.entries,
      togglePinClipboard: s.togglePin,
      removeClipboard: s.remove,
    })),
  );

  const pushPaste = useComposerDraftStore((s) => s.pushPaste);

  // Reset transient UI state when the sheet closes
  useEffect(() => {
    if (!isVisible) {
      setSearchQuery('');
      setShowNewForm(false);
      setRowMenu(null);
      setConfirmDelete(null);
      setSavingClipboardAsSnippet(null);
    }
  }, [isVisible]);

  // ── Shared paste / send ───────────────────────

  const pasteToComposer = useCallback(
    (content: string) => {
      if (!activeSessionId) {
        Alert.alert('No active session', 'Open a session first to paste here.');
        return;
      }
      pushPaste(activeSessionId, content);
      onClose();
    },
    [activeSessionId, pushPaste, onClose],
  );

  const sendNow = useCallback(
    (content: string) => {
      if (!activeSessionId) {
        Alert.alert('No active session', 'Open a session first.');
        return;
      }
      wsClient.sendUserText(activeSessionId, content);
      onClose();
    },
    [activeSessionId, onClose],
  );

  // ── Prompt actions ────────────────────────────

  const handleSelectPrompt = useCallback(
    (prompt: Prompt) => {
      recordUse(prompt.id);
      pasteToComposer(prompt.content);
    },
    [recordUse, pasteToComposer],
  );

  const handleLongPress = useCallback((prompt: Prompt) => {
    setRowMenu({ kind: 'prompt', prompt });
  }, []);

  // ── Clipboard actions ─────────────────────────

  const handleSelectClipboard = useCallback(
    (entry: ClipboardEntry) => {
      pasteToComposer(entry.content);
    },
    [pasteToComposer],
  );

  const handleLongPressClipboard = useCallback((entry: ClipboardEntry) => {
    setRowMenu({ kind: 'clipboard', entry });
  }, []);

  const handleSaveClipboardAsSnippet = useCallback(
    (title: string) => {
      const trimmed = title.trim();
      if (trimmed && savingClipboardAsSnippet) {
        addPrompt({
          title: trimmed,
          content: savingClipboardAsSnippet.content,
          tags: [],
          isPinned: false,
        });
      }
      setSavingClipboardAsSnippet(null);
    },
    [savingClipboardAsSnippet, addPrompt],
  );

  const handleEditTitleSubmit = useCallback(
    (newTitle: string) => {
      if (editingPrompt && newTitle.trim()) {
        updatePrompt(editingPrompt.id, { title: newTitle.trim() });
      }
      setEditingPrompt(null);
    },
    [editingPrompt, updatePrompt],
  );

  const handleNewPromptSave = useCallback(
    (title: string, content: string) => {
      addPrompt({ title, content, tags: [], isPinned: false });
      setShowNewForm(false);
      Keyboard.dismiss();
    },
    [addPrompt],
  );

  // ── Action menu items ─────────────────────────

  const menuItems: ActionSheetItem[] = useMemo(() => {
    if (!rowMenu) return [];

    if (rowMenu.kind === 'prompt') {
      const prompt = rowMenu.prompt;
      return [
        {
          label: 'Send now',
          iconName: 'send',
          onPress: () => {
            recordUse(prompt.id);
            sendNow(prompt.content);
          },
        },
        {
          label: 'Edit title',
          iconName: 'edit-3',
          onPress: () => setEditingPrompt(prompt),
        },
        {
          label: prompt.isPinned ? 'Unpin' : 'Pin',
          iconName: 'bookmark',
          onPress: () =>
            updatePrompt(prompt.id, { isPinned: !prompt.isPinned }),
        },
        {
          label: 'Delete',
          iconName: 'trash-2',
          style: 'destructive',
          onPress: () => setConfirmDelete(prompt),
        },
      ];
    }

    const entry = rowMenu.entry;
    return [
      {
        label: 'Send now',
        iconName: 'send',
        onPress: () => sendNow(entry.content),
      },
      {
        label: 'Save as snippet…',
        iconName: 'bookmark',
        onPress: () => setSavingClipboardAsSnippet(entry),
      },
      {
        label: entry.pinned ? 'Unpin' : 'Pin',
        iconName: 'bookmark',
        onPress: () => togglePinClipboard(entry.id),
      },
      {
        label: 'Copy to system',
        iconName: 'copy',
        onPress: () => {
          void Clipboard.setStringAsync(entry.content);
        },
      },
      {
        label: 'Delete',
        iconName: 'trash-2',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Delete clipboard entry?', undefined, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => removeClipboard(entry.id),
            },
          ]),
      },
    ];
  }, [rowMenu, updatePrompt, recordUse, sendNow, togglePinClipboard, removeClipboard]);

  // ── Build list data ───────────────────────────

  const listData: ListItem[] = useMemo(() => {
    const items: ListItem[] = [];
    const q = searchQuery.trim().toLowerCase();

    if (q) {
      const promptResults = searchPrompts(searchQuery);
      const clipboardResults = clipboardEntries.filter((e) =>
        e.content.toLowerCase().includes(q),
      );

      if (promptResults.length > 0) {
        items.push({ kind: 'section', id: 'search-snippets', title: 'Snippets' });
        promptResults.forEach((p) =>
          items.push({ kind: 'prompt', id: p.id, prompt: p }),
        );
      }
      if (clipboardResults.length > 0) {
        items.push({ kind: 'section', id: 'search-clipboard', title: 'Clipboard' });
        clipboardResults.forEach((e) =>
          items.push({ kind: 'clipboard', id: 'c-' + e.id, entry: e }),
        );
      }
      return items;
    }

    const pinned = getPinned();
    if (pinned.length > 0) {
      items.push({ kind: 'section', id: 'pinned-header', title: 'Pinned' });
      pinned.forEach((p) =>
        items.push({ kind: 'prompt', id: p.id, prompt: p }),
      );
    }

    const recent = getRecent(20);
    const pinnedIds = new Set(pinned.map((p) => p.id));
    const recentFiltered = recent.filter((p) => !pinnedIds.has(p.id));

    if (recentFiltered.length > 0) {
      items.push({ kind: 'section', id: 'recent-header', title: 'Recent snippets' });
      recentFiltered.forEach((p) =>
        items.push({ kind: 'prompt', id: p.id, prompt: p }),
      );
    }

    // Clipboard section — show pinned clipboard first, then recent unpinned,
    // capped to keep the board manageable.
    const cbPinned = clipboardEntries.filter((e) => e.pinned);
    const cbUnpinned = clipboardEntries
      .filter((e) => !e.pinned)
      .slice(0, MAX_CLIPBOARD_IN_BOARD);
    const cbAll = [...cbPinned, ...cbUnpinned];

    if (cbAll.length > 0) {
      items.push({ kind: 'section', id: 'clipboard-header', title: 'Clipboard' });
      cbAll.forEach((e) =>
        items.push({ kind: 'clipboard', id: 'c-' + e.id, entry: e }),
      );
    }

    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store methods are stable via get()
  }, [searchQuery, prompts, clipboardEntries]);

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.kind === 'section') {
        return <SheetSectionHeader title={item.title} />;
      }
      if (item.kind === 'prompt') {
        return (
          <PromptItem
            prompt={item.prompt}
            onPress={() => handleSelectPrompt(item.prompt)}
            onLongPress={() => handleLongPress(item.prompt)}
          />
        );
      }
      const e = item.entry;
      return (
        <TouchableOpacity
          style={styles.clipboardRow}
          onPress={() => handleSelectClipboard(e)}
          onLongPress={() => handleLongPressClipboard(e)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Paste clipboard entry: ${clipboardPreview(e.content)}`}
        >
          <Icon
            name="clipboard"
            size={14}
            color={e.pinned ? Colors.accent : Colors.textSecondary}
            style={styles.clipboardIcon}
          />
          <Text style={styles.clipboardText} numberOfLines={2}>
            {clipboardPreview(e.content)}
          </Text>
        </TouchableOpacity>
      );
    },
    [handleSelectPrompt, handleLongPress, handleSelectClipboard, handleLongPressClipboard],
  );

  const keyExtractor = useCallback((item: ListItem) => item.id, []);

  // ── Empty state ───────────────────────────────

  const ListEmpty = () => {
    const isSearching = searchQuery.trim().length > 0;
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>
          {isSearching ? 'No matches' : 'No prompts yet'}
        </Text>
        <Text style={styles.emptySubtext}>
          {isSearching
            ? `Nothing matches "${searchQuery.trim()}".`
            : 'Tap "Add" in the header to save your first prompt.'}
        </Text>
      </View>
    );
  };

  // ─────────────────────────────────────────────

  return (
    <>
      <SheetShell
        isVisible={isVisible}
        onClose={onClose}
        heightRatio={0.7}
      >
        <SheetHeader
          title="Prompt Board"
          trailingAction={{
            label: showNewForm ? 'Close' : 'Add',
            onPress: () => setShowNewForm((v) => !v),
            primary: true,
          }}
        />

        {/* Search bar (kept as PromptSearchBar — preserves existing styling). */}
        <PromptSearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search prompts…"
        />

        {/* New prompt inline form */}
        {showNewForm && (
          <NewPromptForm
            onSave={handleNewPromptSave}
            onCancel={() => setShowNewForm(false)}
          />
        )}

        {/* Prompt list */}
        <FlatList
          data={listData}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ListEmptyComponent={ListEmpty}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={styles.list}
        />

        {/* Edit title modal */}
        <TextInputModal
          visible={editingPrompt !== null}
          title="Edit title"
          defaultValue={editingPrompt?.title ?? ''}
          onSubmit={handleEditTitleSubmit}
          onCancel={() => setEditingPrompt(null)}
        />
      </SheetShell>

      {/* Long-press action menu */}
      <ActionSheet
        isVisible={rowMenu !== null}
        onClose={() => setRowMenu(null)}
        title={
          rowMenu?.kind === 'prompt'
            ? rowMenu.prompt.title
            : rowMenu?.kind === 'clipboard'
              ? clipboardPreview(rowMenu.entry.content)
              : undefined
        }
        actions={menuItems}
      />

      {/* Delete confirmation */}
      <ActionSheet
        isVisible={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete prompt"
        message={confirmDelete ? `Delete "${confirmDelete.title}"?` : undefined}
        actions={
          confirmDelete
            ? [
                {
                  label: 'Delete',
                  style: 'destructive',
                  iconName: 'trash-2',
                  onPress: () => deletePrompt(confirmDelete.id),
                },
              ]
            : []
        }
      />

      {/* Save clipboard entry as snippet — title prompt */}
      <TextInputModal
        visible={savingClipboardAsSnippet !== null}
        title="Save as snippet"
        message="Enter a title for this snippet:"
        onSubmit={handleSaveClipboardAsSnippet}
        onCancel={() => setSavingClipboardAsSnippet(null)}
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

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 48,
    gap: Spacing.sm,
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
    paddingHorizontal: Spacing.xxxl,
  },

  clipboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  clipboardIcon: {
    marginTop: 1,
  },
  clipboardText: {
    flex: 1,
    color: Colors.textPrimary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body,
    lineHeight: 20,
  },
});
