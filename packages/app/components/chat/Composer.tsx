// ──────────────────────────────────────────────
// Composer — chat-style multi-line input + send/stop button
// ──────────────────────────────────────────────
//
// F21 adds a `+` button left of the input that opens an attachments
// sheet: insert `@-path`, pick photo from library, or take a photo.
// Picked images attach inline; on send we ship a multipart
// UserContentBlock[] (images first, then text) via sendUserMessage.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { readAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import { useSessionsStore } from '../../stores/sessions.store';
import { useComposerDraftStore } from '../../stores/composer-draft.store';
import { useShallow } from 'zustand/react/shallow';
import { wsClient } from '../../services/ws-client';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize } from '../../constants/typography';
import { WInput } from '../ui/WInput';
import { Icon } from '../ui/Icon';
import type { PermissionMode, UserContentBlock } from '@walccy/protocol';

const MODE_OPTIONS: ReadonlyArray<{ mode: PermissionMode; label: string }> = [
  { mode: 'default', label: 'Default' },
  { mode: 'acceptEdits', label: 'Auto-edit' },
  { mode: 'plan', label: 'Plan' },
  { mode: 'bypassPermissions', label: 'Bypass' },
];

const MAX_ATTACHMENTS = 4;

interface Attachment {
  id: string;
  uri: string;
  mediaType: string;
  base64: string;
}

interface ComposerProps {
  sessionId: string;
  onOpenPromptBoard?: () => void;
}

export function Composer({ sessionId, onOpenPromptBoard }: ComposerProps): React.ReactElement {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const inputRef = useRef<TextInput | null>(null);
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const insets = useSafeAreaInsets();

  // When the keyboard is up it already covers the home-indicator area, so
  // the bottom safe-area inset would just be dead space between the input
  // and the keyboard. Drop it while the keyboard is visible.
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvt, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Consume pending paste from the Prompt Board / clipboard sheets.
  // Replaces empty input; appends with a newline if there's already a draft
  // so we don't clobber typing in progress.
  const pendingPaste = useComposerDraftStore((s) => s.pending[sessionId]);
  const clearPaste = useComposerDraftStore((s) => s.clearPaste);
  const lastConsumedNonceRef = useRef<number>(0);
  useEffect(() => {
    if (!pendingPaste) return;
    if (pendingPaste.nonce === lastConsumedNonceRef.current) return;
    lastConsumedNonceRef.current = pendingPaste.nonce;
    setText((prev) => {
      const trimmed = prev.trimEnd();
      if (trimmed.length === 0) return pendingPaste.text;
      return trimmed + '\n' + pendingPaste.text;
    });
    clearPaste(sessionId);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [pendingPaste, sessionId, clearPaste]);

  // The session is "streaming" while it is generating a turn — drive the
  // stop/send swap from the daemon-reported status.
  const { status, waitingForInput, permissionMode } = useSessionsStore(
    useShallow((s) => {
      const session = s.sessions[sessionId];
      return {
        status: session?.status ?? 'idle',
        waitingForInput: session?.waitingForInput ?? false,
        permissionMode: session?.permissionMode,
      };
    })
  );
  const activeMode: PermissionMode = permissionMode ?? 'default';
  const streaming = status === 'active' && !waitingForInput;
  const hasAttachments = attachments.length > 0;
  const canSend = (text.trim().length > 0 || hasAttachments) && !streaming;
  const bypassActive = activeMode === 'bypassPermissions';
  const autoEditActive = activeMode === 'acceptEdits';
  const atCap = attachments.length >= MAX_ATTACHMENTS;

  const handleSelectionChange = useCallback(
    (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      selectionRef.current = e.nativeEvent.selection;
    },
    [],
  );

  const handleSend = useCallback(() => {
    const body = text.trim();
    if (!body && attachments.length === 0) return;
    if (attachments.length > 0) {
      const content: UserContentBlock[] = attachments.map((a) => ({
        type: 'image',
        source: { type: 'base64', media_type: a.mediaType, data: a.base64 },
      }));
      if (body) content.push({ type: 'text', text: body });
      wsClient.sendUserMessage(sessionId, content);
    } else {
      wsClient.sendUserText(sessionId, body);
    }
    setText('');
    setAttachments([]);
  }, [sessionId, text, attachments]);

  const handleStop = useCallback(() => {
    wsClient.interrupt(sessionId);
  }, [sessionId]);

  const handleModePress = useCallback(
    (mode: PermissionMode) => {
      if (mode === activeMode) return;
      if (mode === 'bypassPermissions' && activeMode !== 'bypassPermissions') {
        Alert.alert(
          'Enable Bypass mode?',
          'Tool calls will auto-approve without confirmation. You can switch back any time.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Enable', style: 'destructive', onPress: () => wsClient.changePermissionMode(sessionId, mode) },
          ],
        );
        return;
      }
      wsClient.changePermissionMode(sessionId, mode);
    },
    [sessionId, activeMode],
  );

  const insertAtPath = useCallback(() => {
    setText((prev) => {
      const sel = selectionRef.current;
      const start = Math.max(0, Math.min(sel.start, prev.length));
      const end = Math.max(start, Math.min(sel.end, prev.length));
      const next = prev.slice(0, start) + '@' + prev.slice(end);
      const cursor = start + 1;
      // Re-set selection after render
      requestAnimationFrame(() => {
        selectionRef.current = { start: cursor, end: cursor };
        inputRef.current?.setNativeProps?.({ selection: { start: cursor, end: cursor } });
        inputRef.current?.focus();
      });
      return next;
    });
  }, []);

  const mediaTypeFromAsset = (asset: ImagePicker.ImagePickerAsset): string => {
    if (asset.mimeType && asset.mimeType.startsWith('image/')) return asset.mimeType;
    const uri = asset.uri.toLowerCase();
    if (uri.endsWith('.png')) return 'image/png';
    if (uri.endsWith('.webp')) return 'image/webp';
    if (uri.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
  };

  const attachAsset = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    try {
      const base64 = await readAsStringAsync(asset.uri, { encoding: EncodingType.Base64 });
      const mediaType = mediaTypeFromAsset(asset);
      setAttachments((prev) => {
        if (prev.length >= MAX_ATTACHMENTS) return prev;
        return [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            uri: asset.uri,
            mediaType,
            base64,
          },
        ];
      });
    } catch (err) {
      Alert.alert('Could not attach image', err instanceof Error ? err.message : String(err));
    }
  }, []);

  const pickFromLibrary = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Photos access needed',
        'Walccy needs access to your photos. Enable it in Settings > Walccy > Photos.',
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      base64: false,
      quality: 0.8,
    });
    if (result.canceled) return;
    for (const asset of result.assets) {
      await attachAsset(asset);
    }
  }, [attachAsset]);

  const takePhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Camera access needed',
        'Walccy needs camera access. Enable it in Settings > Walccy > Camera.',
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      base64: false,
      quality: 0.8,
    });
    if (result.canceled) return;
    for (const asset of result.assets) {
      await attachAsset(asset);
    }
  }, [attachAsset]);

  const handlePlusPress = useCallback(() => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Insert @-path', 'Pick photo', 'Take photo'],
          cancelButtonIndex: 0,
        },
        (idx) => {
          if (idx === 1) insertAtPath();
          else if (idx === 2) void pickFromLibrary();
          else if (idx === 3) void takePhoto();
        },
      );
    } else {
      setSheetOpen(true);
    }
  }, [insertAtPath, pickFromLibrary, takePhoto]);

  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return (
    <View
      style={[
        styles.container,
        waitingForInput && styles.containerWaiting,
        { paddingBottom: 8 + (keyboardVisible ? 0 : insets.bottom) },
      ]}
    >
      <View style={styles.chipRow}>
        {MODE_OPTIONS.map(({ mode, label }) => {
          const active = mode === activeMode;
          const isBypass = mode === 'bypassPermissions';
          const activeStyle = active
            ? isBypass
              ? styles.chipActiveDanger
              : styles.chipActive
            : styles.chipInactive;
          const activeTextStyle = active
            ? isBypass
              ? styles.chipTextActiveDanger
              : styles.chipTextActive
            : styles.chipTextInactive;
          return (
            <TouchableOpacity
              key={mode}
              style={[styles.chip, activeStyle]}
              onPress={() => handleModePress(mode)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={`Permission mode ${label}`}
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, activeTextStyle]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {bypassActive ? (
        <View style={styles.bypassBanner}>
          <Text style={styles.bypassBannerText}>
            ⚠ Bypass mode — tools auto-approved
          </Text>
        </View>
      ) : autoEditActive ? (
        <View style={styles.autoEditBanner}>
          <Text style={styles.autoEditBannerText}>
            ⚠ Auto-edit — file edits auto-approved
          </Text>
        </View>
      ) : null}
      {hasAttachments ? (
        <View style={styles.attachmentRow}>
          {attachments.map((a) => (
            <View key={a.id} style={styles.thumbWrap}>
              <Image source={{ uri: a.uri }} style={styles.thumb} />
              <TouchableOpacity
                style={styles.thumbRemove}
                onPress={() => removeAttachment(a.id)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Remove attachment"
                hitSlop={8}
              >
                <Text style={styles.thumbRemoveGlyph}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.inputRow}>
        {onOpenPromptBoard ? (
          <TouchableOpacity
            style={[styles.button, styles.plusButton]}
            onPress={onOpenPromptBoard}
            activeOpacity={0.75}
            disabled={streaming}
            accessibilityRole="button"
            accessibilityLabel="Open Prompt Board"
          >
            <Icon name="bookmark" size={18} color={Colors.textPrimary} />
          </TouchableOpacity>
        ) : null}
        {!atCap ? (
          <TouchableOpacity
            style={[styles.button, styles.plusButton]}
            onPress={handlePlusPress}
            activeOpacity={0.75}
            disabled={streaming}
            accessibilityRole="button"
            accessibilityLabel="Add attachment"
          >
            <Text style={styles.plusGlyph}>+</Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.button, styles.plusButtonDisabled]} accessibilityLabel="Attachment limit reached">
            <Text style={[styles.plusGlyph, styles.plusGlyphDisabled]}>+</Text>
          </View>
        )}
        <WInput
          ref={inputRef}
          variant="long"
          containerStyle={styles.inputWrap}
          value={text}
          onChangeText={setText}
          onSelectionChange={handleSelectionChange}
          placeholder="Message Claude…"
          editable={!streaming}
          accessibilityLabel="Message input"
          accessibilityHint="Type a message and tap send"
        />
        {streaming ? (
          <TouchableOpacity
            style={[styles.button, styles.stopButton]}
            onPress={handleStop}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Stop"
          >
            <View style={styles.stopSquare} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.button, styles.sendButton, !canSend && styles.disabled]}
            onPress={handleSend}
            disabled={!canSend}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Send"
          >
            <Text style={styles.sendGlyph}>↑</Text>
          </TouchableOpacity>
        )}
      </View>
      <Modal
        visible={sheetOpen}
        transparent
        animationType="fade"
        onRequestClose={closeSheet}
      >
        <Pressable style={styles.sheetBackdrop} onPress={closeSheet}>
          <Pressable style={styles.sheet} onPress={() => { /* swallow */ }}>
            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => { closeSheet(); insertAtPath(); }}
              accessibilityRole="button"
            >
              <Text style={styles.sheetItemText}>Insert @-path</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => { closeSheet(); void pickFromLibrary(); }}
              accessibilityRole="button"
            >
              <Text style={styles.sheetItemText}>Pick photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => { closeSheet(); void takePhoto(); }}
              accessibilityRole="button"
            >
              <Text style={styles.sheetItemText}>Take photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sheetItem, styles.sheetCancel]}
              onPress={closeSheet}
              accessibilityRole="button"
            >
              <Text style={[styles.sheetItemText, styles.sheetCancelText]}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: 8,
  },
  inputRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 6,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  chipActiveDanger: {
    backgroundColor: Colors.accentRed + '33',
    borderColor: Colors.accentRed,
  },
  chipInactive: {
    backgroundColor: 'transparent',
    borderColor: Colors.border,
  },
  chipText: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: '600',
  },
  chipTextActive: {
    color: Colors.textPrimary,
  },
  chipTextActiveDanger: {
    color: Colors.accentRed,
  },
  chipTextInactive: {
    color: Colors.textSecondary,
  },
  bypassBanner: {
    marginHorizontal: 4,
    marginBottom: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.accentAmber,
    borderRadius: 4,
    backgroundColor: Colors.accentAmber + '14',
  },
  bypassBannerText: {
    color: Colors.accentAmber,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: '600',
  },
  autoEditBanner: {
    marginHorizontal: 4,
    marginBottom: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.accentAmber + '55',
    borderRadius: 4,
    backgroundColor: Colors.accentAmber + '14',
  },
  autoEditBannerText: {
    color: Colors.accentAmber,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: '600',
  },
  containerWaiting: {
    borderTopColor: Colors.accentAmber,
  },
  attachmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 4,
    paddingBottom: 6,
  },
  thumbWrap: {
    width: 64,
    height: 64,
    borderRadius: 8,
    overflow: 'visible',
    position: 'relative',
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: Colors.surfaceHigh,
  },
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.surfaceHigh,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveGlyph: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontFamily: FontFamily.ui,
    fontWeight: '700',
    lineHeight: 14,
  },
  inputWrap: {
    flex: 1,
  },
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusButton: {
    backgroundColor: Colors.surfaceHigh,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  plusButtonDisabled: {
    backgroundColor: Colors.surfaceHigh,
    borderWidth: 1,
    borderColor: Colors.border,
    opacity: 0.4,
  },
  plusGlyph: {
    color: Colors.textPrimary,
    fontSize: 22,
    fontFamily: FontFamily.ui,
    fontWeight: '600',
    lineHeight: 24,
  },
  plusGlyphDisabled: {
    color: Colors.textSecondary,
  },
  sendButton: {
    backgroundColor: Colors.accent,
  },
  stopButton: {
    backgroundColor: Colors.accentRed,
  },
  disabled: {
    opacity: 0.35,
  },
  sendGlyph: {
    color: Colors.textPrimary,
    fontSize: 20,
    fontFamily: FontFamily.ui,
    fontWeight: '700',
    lineHeight: 22,
  },
  stopSquare: {
    width: 12,
    height: 12,
    borderRadius: 2,
    backgroundColor: Colors.textPrimary,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: '#00000099',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 24,
  },
  sheetItem: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sheetItemText: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.input,
    fontWeight: '600',
  },
  sheetCancel: {
    borderBottomWidth: 0,
    marginTop: 8,
  },
  sheetCancelText: {
    color: Colors.textSecondary,
  },
});
