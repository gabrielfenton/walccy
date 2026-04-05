// ──────────────────────────────────────────────
// Walccy — PromptLibrarySheet
// Bottom sheet modal for browsing and using saved prompts.
// ──────────────────────────────────────────────

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Keyboard,
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
import { usePromptLibraryStore } from '../../stores/prompt-library.store';
import type { Prompt } from '../../stores/prompt-library.store';
import { PromptSearchBar } from './PromptSearchBar';
import { PromptItem } from './PromptItem';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../constants/typography';
import { Spacing } from '../../constants/spacing';

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const SCREEN_HEIGHT = Dimensions.get('window').height;
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.7;

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
// Section header
// ──────────────────────────────────────────────

function SectionHeader({ title }: { title: string }): React.ReactElement {
  return (
    <View style={sectionStyles.container}>
      <Text style={sectionStyles.text}>{title}</Text>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surfaceHigh,
  },
  text: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: 11,
    fontWeight: FontWeight.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
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
  activeSessionId,
}: PromptLibrarySheetProps): React.ReactElement {
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;

  const [searchQuery, setSearchQuery] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);

  const {
    prompts,
    addPrompt,
    updatePrompt,
    deletePrompt,
    recordUse,
    searchPrompts,
    getPinned,
    getRecent,
  } = usePromptLibraryStore();

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
      // Reset state when closing
      setSearchQuery('');
      setShowNewForm(false);
    }
  }, [isVisible, translateY]);

  // ── Prompt actions ────────────────────────────

  const handleSelectPrompt = useCallback(
    (prompt: Prompt) => {
      recordUse(prompt.id);
      onSelectPrompt(prompt.content);
      onClose();
    },
    [recordUse, onSelectPrompt, onClose]
  );

  const handleLongPress = useCallback(
    (prompt: Prompt) => {
      const pinLabel = prompt.isPinned ? 'Unpin' : 'Pin';
      Alert.alert(prompt.title, undefined, [
        {
          text: 'Edit',
          onPress: () => {
            Alert.prompt(
              'Edit title',
              undefined,
              (newTitle) => {
                if (newTitle?.trim()) {
                  updatePrompt(prompt.id, { title: newTitle.trim() });
                }
              },
              'plain-text',
              prompt.title
            );
          },
        },
        {
          text: pinLabel,
          onPress: () => updatePrompt(prompt.id, { isPinned: !prompt.isPinned }),
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Delete prompt',
              `Delete "${prompt.title}"?`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => deletePrompt(prompt.id),
                },
              ]
            );
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [updatePrompt, deletePrompt]
  );

  const handleNewPromptSave = useCallback(
    (title: string, content: string) => {
      addPrompt({ title, content, tags: [], isPinned: false });
      setShowNewForm(false);
      Keyboard.dismiss();
    },
    [addPrompt]
  );

  // ── Build list data ───────────────────────────

  const listData: ListItem[] = React.useMemo(() => {
    const items: ListItem[] = [];

    if (searchQuery.trim()) {
      const results = searchPrompts(searchQuery);
      if (results.length > 0) {
        items.push({ kind: 'section', id: 'search-header', title: 'Results' });
        results.forEach((p) =>
          items.push({ kind: 'prompt', id: p.id, prompt: p })
        );
      }
      return items;
    }

    const pinned = getPinned();
    if (pinned.length > 0) {
      items.push({ kind: 'section', id: 'pinned-header', title: 'Pinned' });
      pinned.forEach((p) =>
        items.push({ kind: 'prompt', id: p.id, prompt: p })
      );
    }

    const recent = getRecent(20);
    const pinnedIds = new Set(pinned.map((p) => p.id));
    const recentFiltered = recent.filter((p) => !pinnedIds.has(p.id));

    if (recentFiltered.length > 0) {
      items.push({ kind: 'section', id: 'recent-header', title: 'Recent' });
      recentFiltered.forEach((p) =>
        items.push({ kind: 'prompt', id: p.id, prompt: p })
      );
    }

    return items;
  }, [searchQuery, prompts, searchPrompts, getPinned, getRecent]);

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.kind === 'section') {
        return <SectionHeader title={item.title} />;
      }
      return (
        <PromptItem
          prompt={item.prompt}
          onPress={() => handleSelectPrompt(item.prompt)}
          onLongPress={() => handleLongPress(item.prompt)}
        />
      );
    },
    [handleSelectPrompt, handleLongPress]
  );

  const keyExtractor = useCallback((item: ListItem) => item.id, []);

  // ── Empty state ───────────────────────────────

  const ListEmpty = () => (
    <View style={styles.emptyState}>
      <Text style={styles.emptyIcon}>📚</Text>
      <Text style={styles.emptyText}>No prompts yet</Text>
      <Text style={styles.emptySubtext}>
        Tap [+ New] to add your first prompt
      </Text>
    </View>
  );

  // ─────────────────────────────────────────────

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Backdrop */}
      <TouchableWithoutFeedback
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close prompt library"
      >
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      {/* Sheet */}
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <KeyboardAvoidingView
          style={styles.sheetInner}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Prompt Library</Text>
            <TouchableOpacity
              onPress={() => setShowNewForm((v) => !v)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Add new prompt"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.newButton}>+ New</Text>
            </TouchableOpacity>
          </View>

          {/* Search bar */}
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
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },

  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_HEIGHT,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },

  sheetInner: {
    flex: 1,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },

  headerTitle: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: 16,
    fontWeight: FontWeight.bold,
  },

  newButton: {
    color: Colors.accent,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.semiBold,
  },

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
    paddingHorizontal: Spacing.xxxl,
  },
});
