// ──────────────────────────────────────────────
// Walccy — useClipboard hook
// ──────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';
import { clipboardService } from '../services/clipboard.service';
import { wsClient } from '../services/ws-client';
import type { ClipboardState } from '../services/clipboard.service';

export interface UseClipboardReturn {
  hasContent: boolean;
  content: string;
  showBubble: boolean;
  paste: (sessionId: string) => void;
  pasteToAll: (sessionIds: string[]) => void;
  copyToSystem: (text: string) => Promise<void>;
  hideBubble: () => void;
}

export function useClipboard(): UseClipboardReturn {
  const [clipboardState, setClipboardState] = useState<ClipboardState>({
    hasContent: false,
    content: '',
    showBubble: false,
  });

  useEffect(() => {
    const unsubscribe = clipboardService.subscribe((state) => {
      setClipboardState(state);
    });
    return unsubscribe;
  }, []);

  // Capture latest content in a ref-like pattern via the subscribed state.
  // We use an async read from the service to ensure we always send the latest
  // clipboard text even if the React state update hasn't flushed yet.

  const paste = useCallback((sessionId: string): void => {
    clipboardService.getContent().then((text) => {
      if (text.length > 0) {
        wsClient.sendInput(sessionId, text);
      }
    });
  }, []);

  const pasteToAll = useCallback((sessionIds: string[]): void => {
    clipboardService.getContent().then((text) => {
      if (text.length > 0) {
        for (const sessionId of sessionIds) {
          wsClient.sendInput(sessionId, text);
        }
      }
    });
  }, []);

  const copyToSystem = useCallback(async (text: string): Promise<void> => {
    await clipboardService.setContent(text);
    clipboardService.showBubble();
  }, []);

  const hideBubble = useCallback((): void => {
    clipboardService.hideBubble();
  }, []);

  return {
    hasContent: clipboardState.hasContent,
    content: clipboardState.content,
    showBubble: clipboardState.showBubble,
    paste,
    pasteToAll,
    copyToSystem,
    hideBubble,
  };
}
