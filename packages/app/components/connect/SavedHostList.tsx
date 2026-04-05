// ──────────────────────────────────────────────
// Walccy — SavedHostList
// FlatList of previously connected hosts.
// Long press to delete; tap to connect.
// ──────────────────────────────────────────────

import React, { useCallback } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../constants/typography';
import type { SavedHost } from '../../stores/settings.store';

// ── Types ─────────────────────────────────────

export interface SavedHostListProps {
  hosts: SavedHost[];
  onSelectHost: (host: SavedHost) => void;
  onDeleteHost: (id: string) => void;
}

// ── Helpers ───────────────────────────────────

function formatRelativeTime(ms: number): string {
  const diffMs = Date.now() - ms;
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 60) {
    return 'just now';
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return diffMinutes === 1 ? '1 minute ago' : `${diffMinutes} minutes ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
}

// ── Sub-components ────────────────────────────

interface HostRowProps {
  host: SavedHost;
  onSelect: () => void;
  onDelete: () => void;
}

const HostRow: React.FC<HostRowProps> = ({ host, onSelect, onDelete }) => {
  function handleLongPress(): void {
    Alert.alert(
      host.label,
      'Remove this host from your saved list?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: onDelete,
        },
      ]
    );
  }

  const initial = host.label.charAt(0).toUpperCase();

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onSelect}
      onLongPress={handleLongPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`Connect to ${host.label}`}
    >
      {/* Avatar circle */}
      <View style={[styles.avatar, { backgroundColor: host.avatarColor }]}>
        <Text style={styles.avatarText}>{initial}</Text>
      </View>

      {/* Text stack */}
      <View style={styles.textStack}>
        <Text style={styles.label} numberOfLines={1}>
          {host.label}
        </Text>
        <Text style={styles.hostname} numberOfLines={1}>
          {host.host}:{host.port}
        </Text>
        <Text style={styles.lastSeen}>
          {formatRelativeTime(host.lastConnectedAt)}
        </Text>
      </View>

      {/* Chevron */}
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
};

// ── Component ─────────────────────────────────

export const SavedHostList: React.FC<SavedHostListProps> = ({
  hosts,
  onSelectHost,
  onDeleteHost,
}) => {
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SavedHost>) => (
      <HostRow
        host={item}
        onSelect={() => onSelectHost(item)}
        onDelete={() => onDeleteHost(item.id)}
      />
    ),
    [onSelectHost, onDeleteHost]
  );

  const keyExtractor = useCallback((item: SavedHost) => item.id, []);

  return (
    <FlatList
      data={hosts}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      scrollEnabled={false}
      style={styles.list}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />
  );
};

// ── Styles ────────────────────────────────────

const AVATAR_SIZE = 40;

const styles = StyleSheet.create({
  list: {
    width: '100%',
  },

  separator: {
    height: 1,
    backgroundColor: Colors.border,
    marginLeft: 64,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  },

  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  avatarText: {
    color: '#FFFFFF',
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.semiBold,
  },

  textStack: {
    flex: 1,
    gap: 2,
  },

  label: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.medium,
  },

  hostname: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
  },

  lastSeen: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    marginTop: 2,
  },

  chevron: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: 22,
    fontWeight: FontWeight.regular,
    marginLeft: 4,
  },
});
