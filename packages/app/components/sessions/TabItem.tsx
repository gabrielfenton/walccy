// ──────────────────────────────────────────────
// Walccy — TabItem
// A single tab pill in the session tab bar.
// ──────────────────────────────────────────────

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../constants/typography';
import { SessionStatusDot } from './SessionStatusDot';
import type { Session } from '@walccy/protocol';

// ── Types ─────────────────────────────────────

export interface TabItemProps {
  session: Session;
  isActive: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

// ── Helpers ───────────────────────────────────

function truncateName(name: string, maxChars = 12): string {
  if (name.length <= maxChars) return name;
  // Preserve a trailing " N" disambiguator (e.g. "resume-generator 2")
  // so multiple tabs in the same cwd remain distinguishable after truncation.
  const m = name.match(/^(.*?)( \d+)$/);
  if (m) {
    const [, head, suffix] = m;
    const headRoom = maxChars - suffix.length - 1; // 1 for the ellipsis
    if (headRoom >= 1) {
      if (head.length <= headRoom) return head + suffix;
      return head.slice(0, headRoom) + '…' + suffix;
    }
  }
  return name.slice(0, maxChars - 1) + '…';
}

// ── Component ─────────────────────────────────

export const TabItem: React.FC<TabItemProps> = ({
  session,
  isActive,
  onPress,
  onLongPress,
}) => {
  return (
    <TouchableOpacity
      style={[styles.pill, isActive ? styles.pillActive : styles.pillInactive]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.75}
      accessibilityRole="tab"
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={session.name}
    >
      <View style={styles.inner}>
        <SessionStatusDot status={session.status} size={6} />
        <Text
          style={[styles.label, isActive ? styles.labelActive : styles.labelInactive]}
          numberOfLines={1}
        >
          {truncateName(session.name)}
        </Text>
        {session.owned === false ? (
          <View
            style={[styles.roBadge, isActive ? styles.roBadgeActive : null]}
            accessibilityLabel="Read-only session"
          >
            <Text style={[styles.roBadgeText, isActive ? styles.roBadgeTextActive : null]}>
              RO
            </Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
};

// ── Styles ────────────────────────────────────

const styles = StyleSheet.create({
  pill: {
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },

  pillActive: {
    backgroundColor: Colors.accent,
  },

  pillInactive: {
    backgroundColor: Colors.surfaceHigh,
  },

  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  label: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.tabLabel,
    fontWeight: FontWeight.medium,
  },

  labelActive: {
    color: '#FFFFFF',
  },

  labelInactive: {
    color: Colors.textSecondary,
  },

  roBadge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    backgroundColor: Colors.accentAmber + '22',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.accentAmber,
  },
  roBadgeActive: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderColor: 'rgba(255,255,255,0.45)',
  },
  roBadgeText: {
    color: Colors.accentAmber,
    fontFamily: FontFamily.ui,
    fontSize: 10,
    fontWeight: FontWeight.bold,
    letterSpacing: 0.5,
  },
  roBadgeTextActive: {
    color: '#FFFFFF',
  },
});
