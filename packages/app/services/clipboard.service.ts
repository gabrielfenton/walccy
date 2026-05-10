// ──────────────────────────────────────────────
// Walccy — Clipboard service
// Uses expo-clipboard
// ──────────────────────────────────────────────

import * as Clipboard from 'expo-clipboard';
import type { EventSubscription } from 'expo-modules-core';
import { CLIPBOARD_BUBBLE_TIMEOUT } from '../constants/config';
import { clipboardHistoryStore, type ClipboardSource } from '../stores/clipboard-history.store';
import { settingsStore } from '../stores/settings.store';

// ──────────────────────────────────────────────
// Sensitive-content detection
// ──────────────────────────────────────────────

const PEM_RE = /-----BEGIN [A-Z ]+-----/;
const SSH_PUBKEY_RE = /(?:^|\s)ssh-(?:rsa|ed25519|dss|ecdsa)\s+/;
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const AWS_KEY_RE = /^(?:AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}$/;
const GH_PAT_RE = /^(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}$/;
const HEX_RE = /^[0-9a-fA-F]+$/;
const BASE64URL_RE = /^[A-Za-z0-9_+/=-]+$/;

/**
 * Best-effort heuristic for "this looks like a secret, do not persist".
 * Conservative: false negatives are acceptable; false positives mean the
 * user just doesn't see this entry in clipboard history (not a regression).
 */
export function isLikelySensitive(content: string): boolean {
  if (!content) return false;
  if (PEM_RE.test(content)) return true;
  if (SSH_PUBKEY_RE.test(content)) return true;

  const trimmed = content.trim();

  if (trimmed.length >= 40 && JWT_RE.test(trimmed)) return true;
  if (AWS_KEY_RE.test(trimmed)) return true;
  if (GH_PAT_RE.test(trimmed)) return true;

  // Long random-looking tokens with no whitespace.
  if (
    trimmed.length >= 24 &&
    trimmed.length <= 200 &&
    !/\s/.test(trimmed)
  ) {
    if (HEX_RE.test(trimmed) && trimmed.length >= 24) return true;
    if (BASE64URL_RE.test(trimmed) && trimmed.length >= 32) return true;
  }

  return false;
}

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

  private clipboardSubscription: EventSubscription | null = null;
  private lastKnownContent = '';

  private state: ClipboardState = {
    hasContent: false,
    content: '',
    showBubble: false,
  };

  // ── Public API ────────────────────────────────

  /**
   * Start monitoring the clipboard via event listener.
   * Falls back to polling if the event-based API is unavailable.
   */
  startMonitoring(): void {
    if (this.clipboardSubscription) return; // already running

    // Use event-based monitoring (no polling needed)
    this.clipboardSubscription = Clipboard.addClipboardListener(() => {
      this.pollClipboard();
    });

    // Poll once on start to capture current clipboard state
    this.pollClipboard();
  }

  /**
   * Stop monitoring the clipboard.
   */
  stopMonitoring(): void {
    if (this.clipboardSubscription) {
      Clipboard.removeClipboardListener(this.clipboardSubscription);
      this.clipboardSubscription = null;
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

  /** Write text to the clipboard. `source` lets the history store distinguish
   *  copies that originated inside the terminal from external system copies. */
  async setContent(text: string, source: ClipboardSource = 'manual'): Promise<void> {
    await Clipboard.setStringAsync(text);
    this.lastKnownContent = text;
    this.updateState({ hasContent: text.length > 0, content: text });
    if (text.length > 0) {
      clipboardHistoryStore.getState().addEntry(text, source);
    }
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
        // Bubble + state always update — user can paste current clipboard,
        // they just won't see the entry written to persistent history if
        // it looks sensitive.
        this.updateState({ content, hasContent: content.length > 0 });

        if (content.length === 0) return;

        // Respect user preference to fully disable system-content ingestion.
        const captureEnabled = settingsStore.getState().clipboardCaptureSystemContent;
        if (!captureEnabled) return;

        // Heuristic content filter.
        if (isLikelySensitive(content)) return;

        // Honor OS-level "this is a password" hint when available.
        try {
          const hpc = (Clipboard as unknown as {
            hasPasswordContentTypeAsync?: () => Promise<boolean>;
          }).hasPasswordContentTypeAsync;
          if (typeof hpc === 'function') {
            const isPassword = await hpc();
            if (isPassword) return;
          }
        } catch {
          // Older expo-clipboard doesn't expose this — fine.
        }

        clipboardHistoryStore.getState().addEntry(content, 'system');
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
