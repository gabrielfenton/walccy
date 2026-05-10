// ──────────────────────────────────────────────
// Walccy — PromptLibrarySheet
// Bottom sheet modal for browsing and using saved prompts.
// ──────────────────────────────────────────────

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Alert,
  FlatList,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { TextInputModal } from '../ui/TextInputModal';
import { usePromptLibraryStore } from '../../stores/prompt-library.store';
import type { Prompt } from '../../stores/prompt-library.store';
import { PromptSearchBar } from './PromptSearchBar';
import { PromptItem } from './PromptItem';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../constants/typography';
import { Spacing } from '../../constants/spacing';
import { SheetShell } from '../ui/SheetShell';
import { SheetHeader } from '../ui/SheetHeader';
import { SheetSectionHeader } from '../ui/SheetSectionHeader';
import { ActionSheet, type ActionSheetItem } from '../ui/ActionSheet';

// ──────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────

interface PromptLibrarySheetProps {
  isVisible: boolean;
  onClose: () => void;
  onSelectPrompt: (content: string) => void;
  activeSessionId: string | null;
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
      <TextInput
        style={formStyles.titleInput}
        value={title}
        onChangeText={setTitle}
        placeholder="Prompt title (required)"
        placeholderTextColor={Colors.textSecondary}
        autoFocus
        returnKeyType="next"
        accessibilityLabel="Prompt title"
      />
      <TextInput
        style={formStyles.contentInput}
        value={content}
        onChangeText={setContent}
        placeholder="Prompt content…"
        placeholderTextColor={Colors.textSecondary}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        returnKeyType="default"
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
    minHeight: 88,
    paddingVertical: Spacing.sm,
    paddingHorizontal: 0,
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
  | { kind: 'prompt'; id: string; prompt: Prompt };

// ──────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────

export function PromptLibrarySheet({
  isVisible,
  onClose,
  onSelectPrompt,
}: PromptLibrarySheetProps): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [menuPrompt, setMenuPrompt] = useState<Prompt | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Prompt | null>(null);

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

  // Reset transient UI state when the sheet closes
  useEffect(() => {
    if (!isVisible) {
      setSearchQuery('');
      setShowNewForm(false);
      setMenuPrompt(null);
      setConfirmDelete(null);
    }
  }, [isVisible]);

  // ── Prompt actions ────────────────────────────

  const handleSelectPrompt = useCallback(
    (prompt: Prompt) => {
      recordUse(prompt.id);
      onSelectPrompt(prompt.content);
      onClose();
    },
    [recordUse, onSelectPrompt, onClose],
  );

  const handleLongPress = useCallback((prompt: Prompt) => {
    setMenuPrompt(prompt);
  }, []);

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
    if (!menuPrompt) return [];
    return [
      {
        label: 'Edit title',
        iconName: 'edit-3',
        onPress: () => setEditingPrompt(menuPrompt),
      },
      {
        label: menuPrompt.isPinned ? 'Unpin' : 'Pin',
        iconName: 'bookmark',
        onPress: () =>
          updatePrompt(menuPrompt.id, { isPinned: !menuPrompt.isPinned }),
      },
      {
        label: 'Delete',
        iconName: 'trash-2',
        style: 'destructive',
        onPress: () => setConfirmDelete(menuPrompt),
      },
    ];
  }, [menuPrompt, updatePrompt]);

  // ── Build list data ───────────────────────────

  const listData: ListItem[] = useMemo(() => {
    const items: ListItem[] = [];

    if (searchQuery.trim()) {
      const results = searchPrompts(searchQuery);
      if (results.length > 0) {
        items.push({ kind: 'section', id: 'search-header', title: 'Results' });
        results.forEach((p) =>
          items.push({ kind: 'prompt', id: p.id, prompt: p }),
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
      items.push({ kind: 'section', id: 'recent-header', title: 'Recent' });
      recentFiltered.forEach((p) =>
        items.push({ kind: 'prompt', id: p.id, prompt: p }),
      );
    }

    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store methods are stable via get()
  }, [searchQuery, prompts]);

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.kind === 'section') {
        return <SheetSectionHeader title={item.title} />;
      }
      return (
        <PromptItem
          prompt={item.prompt}
          onPress={() => handleSelectPrompt(item.prompt)}
          onLongPress={() => handleLongPress(item.prompt)}
        />
      );
    },
    [handleSelectPrompt, handleLongPress],
  );

  const keyExtractor = useCallback((item: ListItem) => item.id, []);

  // ── Empty state ───────────────────────────────

  const ListEmpty = () => (
    <View style={styles.emptyState}>
      <Text style={styles.emptyText}>No prompts yet</Text>
      <Text style={styles.emptySubtext}>
        Tap "Add" in the header to save your first prompt.
      </Text>
    </View>
  );

  // ─────────────────────────────────────────────

  return (
    <>
      <SheetShell
        isVisible={isVisible}
        onClose={onClose}
        heightRatio={0.7}
      >
        <SheetHeader
          title="Prompt Library"
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
        isVisible={menuPrompt !== null}
        onClose={() => setMenuPrompt(null)}
        title={menuPrompt?.title}
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
});
