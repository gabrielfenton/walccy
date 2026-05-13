// ──────────────────────────────────────────────
// Walccy — Memory viewer (F26)
// ──────────────────────────────────────────────
//
// Read-only browser for the active session's auto-memory directory.
// File list is rendered as a left rail; tapping a row fetches the file
// body and renders it via the same markdown component the chat uses.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import Markdown from 'react-native-markdown-display';
import { useSessionsStore } from '../stores/sessions.store';
import { useConnectionStore } from '../stores/connection.store';
import { wsClient } from '../services/ws-client';
import { Colors } from '../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../constants/typography';
import type { MemoryFileEntry } from '@walccy/protocol';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MemoryScreen(): React.ReactElement {
  // Allow `walccy://memory?sessionId=<id>` deep-links to pick a session even
  // before the user has navigated into the terminal tab.
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const storeActive = useSessionsStore((s) => s.activeSessionId);
  const activeSessionId =
    typeof params.sessionId === 'string' && params.sessionId.length > 0
      ? params.sessionId
      : storeActive;
  // ws-client.send() silently drops messages when the socket isn't OPEN.
  // Defer the LIST_MEMORY round-trip until the connection settles so the
  // first deep-link mount after a cold start doesn't time out.
  const connectionStatus = useConnectionStore((s) => s.status);
  const [files, setFiles] = useState<MemoryFileEntry[]>([]);
  const [dir, setDir] = useState<string>('');
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [bodyContent, setBodyContent] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    if (!activeSessionId) return;
    setListLoading(true);
    setListError(null);
    try {
      const reply = await wsClient.listMemory(activeSessionId);
      if (reply.error) {
        setListError(reply.error);
        setFiles([]);
        setDir(reply.dir);
      } else {
        setFiles(reply.files);
        setDir(reply.dir);
      }
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setListLoading(false);
    }
  }, [activeSessionId]);

  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    void refreshList();
  }, [refreshList, connectionStatus]);

  const loadFile = useCallback(
    async (name: string) => {
      if (!activeSessionId) return;
      setSelected(name);
      setBodyContent(null);
      setBodyError(null);
      setBodyLoading(true);
      try {
        const reply = await wsClient.listMemory(activeSessionId, name);
        if (reply.error) {
          setBodyError(reply.error);
        } else if (reply.file) {
          setBodyContent(reply.file.content);
        } else {
          setBodyError('Empty response');
        }
      } catch (err) {
        setBodyError(err instanceof Error ? err.message : String(err));
      } finally {
        setBodyLoading(false);
      }
    },
    [activeSessionId],
  );

  const markdownStyles = useMemo(
    () =>
      ({
        body:        { color: Colors.textPrimary, fontFamily: FontFamily.ui, fontSize: FontSize.body },
        heading1:    { color: Colors.textPrimary, fontFamily: FontFamily.ui, fontSize: FontSize.heading, fontWeight: FontWeight.semiBold, marginTop: 12 },
        heading2:    { color: Colors.textPrimary, fontFamily: FontFamily.ui, fontSize: FontSize.body + 2, fontWeight: FontWeight.semiBold, marginTop: 10 },
        heading3:    { color: Colors.textPrimary, fontFamily: FontFamily.ui, fontSize: FontSize.body + 1, fontWeight: FontWeight.semiBold, marginTop: 8 },
        code_inline: { color: Colors.accent, fontFamily: FontFamily.mono, fontSize: FontSize.body - 1, backgroundColor: Colors.surfaceHigh, paddingHorizontal: 4, borderRadius: 4 },
        code_block:  { color: Colors.textPrimary, fontFamily: FontFamily.mono, fontSize: FontSize.body - 1, backgroundColor: Colors.surfaceHigh, padding: 8, borderRadius: 6 },
        fence:       { color: Colors.textPrimary, fontFamily: FontFamily.mono, fontSize: FontSize.body - 1, backgroundColor: Colors.surfaceHigh, padding: 8, borderRadius: 6 },
        link:        { color: Colors.accent },
        hr:          { backgroundColor: Colors.border, height: 1 },
      }) as const,
    [],
  );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/settings');
          }}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
        >
          <Text style={styles.backButtonText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Memory</Text>
        <View style={styles.headerSpacer} />
      </View>

      {!activeSessionId ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            Select a session to view its auto-memory.
          </Text>
        </View>
      ) : (
        <View style={styles.body}>
          <View style={styles.list}>
            {dir.length > 0 && (
              <Text style={styles.dirPath} numberOfLines={1}>
                {dir}
              </Text>
            )}
            {listLoading && files.length === 0 ? (
              <View style={styles.listLoading}>
                <ActivityIndicator color={Colors.accent} />
              </View>
            ) : listError ? (
              <Text style={styles.errorText}>{listError}</Text>
            ) : files.length === 0 ? (
              <Text style={styles.dim}>No memory files yet.</Text>
            ) : (
              <ScrollView style={styles.listScroll}>
                {files.map((f) => {
                  const active = selected === f.name;
                  return (
                    <TouchableOpacity
                      key={f.name}
                      style={[
                        styles.fileRow,
                        active && styles.fileRowActive,
                      ]}
                      onPress={() => loadFile(f.name)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.fileName,
                          active && styles.fileNameActive,
                        ]}
                        numberOfLines={1}
                      >
                        {f.name}
                      </Text>
                      <Text style={styles.fileMeta}>{formatBytes(f.size)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>

          <View style={styles.divider} />

          <ScrollView style={styles.viewer} contentContainerStyle={styles.viewerContent}>
            {!selected ? (
              <Text style={styles.dim}>Select a file to view its contents.</Text>
            ) : bodyLoading ? (
              <ActivityIndicator color={Colors.accent} />
            ) : bodyError ? (
              <Text style={styles.errorText}>{bodyError}</Text>
            ) : bodyContent !== null ? (
              <Markdown style={markdownStyles}>{bodyContent}</Markdown>
            ) : null}
          </ScrollView>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backButton: {
    paddingVertical: 12,
    paddingLeft: 4,
    paddingRight: 16,
    minHeight: 44,
    minWidth: 72,
    justifyContent: 'center',
  },
  backButtonText: {
    color: Colors.accent,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.medium,
  },
  headerTitle: {
    flex: 1,
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.heading,
    fontWeight: FontWeight.semiBold,
    textAlign: 'center',
  },
  headerSpacer: { minWidth: 64 },

  body: { flex: 1 },

  list: {
    maxHeight: 220,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.surface,
  },
  listScroll: { maxHeight: 180 },
  listLoading: { alignItems: 'center', padding: 12 },
  dirPath: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
    marginBottom: 6,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 2,
  },
  fileRowActive: {
    backgroundColor: Colors.accent + '22',
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  fileName: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
    flex: 1,
    marginRight: 8,
  },
  fileNameActive: {
    color: Colors.accent,
    fontWeight: FontWeight.semiBold,
  },
  fileMeta: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption - 1,
  },

  divider: {
    height: 1,
    backgroundColor: Colors.border,
  },

  viewer: { flex: 1 },
  viewerContent: { padding: 16 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    textAlign: 'center',
  },
  dim: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
  },
  errorText: {
    color: Colors.accentRed,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
  },
});
