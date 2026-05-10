// ──────────────────────────────────────────────
// Walccy — useClipboardActions
// Single hook that unifies the four clipboard surfaces:
//   • paste to active session
//   • paste to selected sessions
//   • copy to system (with history capture)
//   • save to Prompt Library
// Also exposes the list of owned (writable) sessions so callers can
// build target-pickers without re-deriving.
// ──────────────────────────────────────────────

import { useCallback, useMemo } from 'react';
import { useSessionsStore } from '../stores/sessions.store';
import { usePromptLibraryStore } from '../stores/prompt-library.store';
import { wsClient } from '../services/ws-client';
import { clipboardService } from '../services/clipboard.service';

export interface PasteTarget {
  id: string;
  name: string;
}

export interface ClipboardActions {
  pasteToActive: (text: string) => void;
  pasteToTargets: (text: string, targetIds: string[]) => void;
  copyToSystem: (text: string) => Promise<void>;
  saveToPromptLibrary: (text: string, title: string) => void;
  ownedTargets: PasteTarget[];
}

export function useClipboardActions(
  activeSessionId: string | null,
): ClipboardActions {
  const sessions = useSessionsStore((s) => s.sessions);

  const ownedTargets = useMemo<PasteTarget[]>(
    () =>
      Object.values(sessions)
        .filter((s) => s.owned !== false)
        .map((s) => ({ id: s.id, name: s.name })),
    [sessions],
  );

  const pasteToActive = useCallback(
    (text: string) => {
      if (!activeSessionId) return;
      wsClient.sendInput(activeSessionId, text);
    },
    [activeSessionId],
  );

  const pasteToTargets = useCallback((text: string, targetIds: string[]) => {
    for (const id of targetIds) {
      wsClient.sendInput(id, text);
    }
  }, []);

  const copyToSystem = useCallback(async (text: string) => {
    await clipboardService.setContent(text, 'terminal');
  }, []);

  const saveToPromptLibrary = useCallback((text: string, title: string) => {
    usePromptLibraryStore.getState().addPrompt({
      title,
      content: text,
      tags: [],
      isPinned: false,
    });
  }, []);

  return {
    pasteToActive,
    pasteToTargets,
    copyToSystem,
    saveToPromptLibrary,
    ownedTargets,
  };
}
