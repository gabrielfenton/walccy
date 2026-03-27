// ──────────────────────────────────────────────
// Walccy — ClipboardPopup
// Modal bottom sheet that appears on terminal text long-press.
// ──────────────────────────────────────────────

import React, { useEffect, useRef } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { wsClient } from '../../services/ws-client';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize } from '../../constants/typography';

// ──────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────

interface ClipboardPopupProps {
  isVisible: boolean;
  selectedText: string;
  activeSessionId: string | null;
  allSessionIds: string[];
  onClose: () => void;
  onSaveToPromptLibrary: (text: string) => void;
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const SHEET_HEIGHT = 260;
const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

export function ClipboardPopup({
  isVisible,
  selectedText,
  activeSessionId,
  allSessionIds,
  onClose,
  onSaveToPromptLibrary,
}: ClipboardPopupProps): React.ReactElement {
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;

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
    }
  }, [isVisible, translateY]);

  const truncatedText =
    selectedText.length > 40
      ? selectedText.slice(0, 40) + '…'
      : selectedText;

  // ── Action handlers ───────────────────────────

  const handlePasteToThis = () => {
    if (activeSessionId) {
      wsClient.sendInput(activeSessionId, selectedText);
    }
    onClose();
  };

  const handlePasteToAll = () => {
    allSessionIds.forEach((id) => wsClient.sendInput(id, selectedText));
    const count = allSessionIds.length;
    onClose();
    Alert.alert('Sent', `Sent to ${count} terminal${count !== 1 ? 's' : ''}`);
  };

  const handleSaveToPromptLibrary = () => {
    onSaveToPromptLibrary(selectedText);
    onClose();
  };

  const handleCopyToClipboard = async () => {
    await Clipboard.setStringAsync(selectedText);
    onClose();
  };

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
      <TouchableWithoutFeedback onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      {/* Sheet */}
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerText} numberOfLines={1}>
            📋 "{truncatedText}"
          </Text>
        </View>

        {/* Actions */}
        <TouchableOpacity
          style={[styles.row, styles.rowBorder]}
          onPress={handlePasteToThis}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <Text style={styles.rowText}>Paste to this terminal</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.row, styles.rowBorder]}
          onPress={handlePasteToAll}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <Text style={styles.rowText}>Paste to ALL terminals</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.row, styles.rowBorder]}
          onPress={handleSaveToPromptLibrary}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <Text style={styles.rowText}>Save to Prompt Library</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.row}
          onPress={handleCopyToClipboard}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <Text style={styles.rowText}>Copy to system clipboard</Text>
        </TouchableOpacity>
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
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },

  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
    fontStyle: 'italic',
  },

  row: {
    height: 52,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowText: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: 15,
  },
});
