// ──────────────────────────────────────────────
// Walccy — ClipboardPopup
// Modal bottom sheet that appears on terminal text long-press.
// Uses the ActionSheet primitive so all the action surfaces in the
// app share one visual + behavioural language.
// ──────────────────────────────────────────────

import React, { useMemo } from 'react';
import { ActionSheet, type ActionSheetItem } from '../ui/ActionSheet';
import { useClipboardActions } from '../../hooks/useClipboardActions';

interface ClipboardPopupProps {
  isVisible: boolean;
  selectedText: string;
  activeSessionId: string | null;
  /**
   * Owned-session ids. Kept for API compat with the caller, but the hook
   * derives the same list internally — we only use this prop to decide
   * whether to show the "Paste to ALL" multi-target action.
   */
  allSessionIds: string[];
  onClose: () => void;
  onSaveToPromptLibrary: (text: string) => void;
}

export function ClipboardPopup({
  isVisible,
  selectedText,
  activeSessionId,
  allSessionIds,
  onClose,
  onSaveToPromptLibrary,
}: ClipboardPopupProps): React.ReactElement {
  const { pasteToActive, pasteToTargets, copyToSystem } =
    useClipboardActions(activeSessionId);

  // Show up to 120 chars in the title slot — ActionSheet caps to 3 lines.
  const previewText =
    selectedText.length > 120 ? selectedText.slice(0, 120) + '…' : selectedText;

  const actions = useMemo<ActionSheetItem[]>(() => {
    const items: ActionSheetItem[] = [
      {
        label: 'Paste to this terminal',
        iconName: 'send',
        style: 'primary',
        onPress: () => pasteToActive(selectedText),
      },
    ];
    if (allSessionIds.length > 1) {
      items.push({
        label: `Paste to ALL terminals (${allSessionIds.length})`,
        iconName: 'send',
        onPress: () => pasteToTargets(selectedText, allSessionIds),
      });
    }
    items.push({
      label: 'Save to Prompt Library',
      iconName: 'bookmark',
      onPress: () => onSaveToPromptLibrary(selectedText),
    });
    items.push({
      label: 'Copy to system clipboard',
      iconName: 'copy',
      onPress: () => {
        void copyToSystem(selectedText);
      },
    });
    return items;
  }, [
    selectedText,
    allSessionIds,
    pasteToActive,
    pasteToTargets,
    copyToSystem,
    onSaveToPromptLibrary,
  ]);

  return (
    <ActionSheet
      isVisible={isVisible}
      onClose={onClose}
      title={previewText}
      actions={actions}
    />
  );
}
