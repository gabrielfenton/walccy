// ──────────────────────────────────────────────
// Walccy — Clipboard service
// Uses expo-clipboard
// ──────────────────────────────────────────────

import * as Clipboard from 'expo-clipboard';
import { CLIPBOARD_BUBBLE_TIMEOUT } from '../constants/config';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface ClipboardState {
  hasContent: boolean;
  content: string;
  showBubble: boolean;
}

type ClipboardListener = (state: ClipboardState) => void;

// ──────────────────────────────────────────────
// ClipboardService
// ──────────────────────────────────────────────

class ClipboardService {
  private listeners: Set<ClipboardListener> = new Set();
  private bubbleTimeout: ReturnType<typeof setTimeout> | null = null;

  private monitorInterval: ReturnType<typeof setInterval> | null = null;
  private lastKnownContent = '';

  private state: ClipboardState = {
    hasContent: false,
    content: '',
    showBubble: false,
  };

  // ── Public API ────────────────────────────────

  /**
   * Start polling the clipboard every second.
   * Should be called when the app foregrounds.
   */
  startMonitoring(): void {
    if (this.monitorInterval) return; // already running

    this.monitorInterval = setInterval(() => {
      this.pollClipboard();
    }, 1000);

    // Poll immediately on start
    this.pollClipboard();
  }

  /**
   * Stop polling the clipboard.
   * Should be called when the app backgrounds.
   */
  stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
  }

  /** Return the current clipboard string content */
  async getContent(): Promise<string> {
    try {
      return (await Clipboard.getStringAsync()) ?? '';
    } catch {
      return '';
    }
  }

  /** Write text to the clipboard */
  async setContent(text: string): Promise<void> {
    await Clipboard.setStringAsync(text);
    this.lastKnownContent = text;
    this.updateState({ hasContent: text.length > 0, content: text });
  }

  /** Show the floating clipboard bubble for CLIPBOARD_BUBBLE_TIMEOUT ms */
  showBubble(): void {
    if (this.bubbleTimeout) {
      clearTimeout(this.bubbleTimeout);
    }
    this.updateState({ showBubble: true });
    this.bubbleTimeout = setTimeout(() => {
      this.bubbleTimeout = null;
      this.updateState({ showBubble: false });
    }, CLIPBOARD_BUBBLE_TIMEOUT);
  }

  /** Immediately hide the floating clipboard bubble */
  hideBubble(): void {
    if (this.bubbleTimeout) {
      clearTimeout(this.bubbleTimeout);
      this.bubbleTimeout = null;
    }
    this.updateState({ showBubble: false });
  }

  /**
   * Subscribe to clipboard state changes.
   * Returns an unsubscribe function.
   */
  subscribe(listener: ClipboardListener): () => void {
    this.listeners.add(listener);
    // Immediately call with current state
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── Private helpers ───────────────────────────

  private async pollClipboard(): Promise<void> {
    try {
      const content = (await Clipboard.getStringAsync()) ?? '';
      if (content !== this.lastKnownContent) {
        this.lastKnownContent = content;
        this.updateState({ content, hasContent: content.length > 0 });
      }
    } catch {
      // Clipboard access can fail silently (e.g., permissions)
    }
  }

  private updateState(partial: Partial<ClipboardState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of Array.from(this.listeners)) {
      listener(this.state);
    }
  }
}

// ──────────────────────────────────────────────
// Singleton export
// ──────────────────────────────────────────────

export const clipboardService = new ClipboardService();
