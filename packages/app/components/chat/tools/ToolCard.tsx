import React, { memo } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../../constants/typography';

export interface ToolCardProps {
  toolName: string;
  state: 'running' | 'complete' | 'error';
  header?: ReactNode;
  children?: ReactNode;
  onPress?: () => void;
  expanded: boolean;
  onToggleExpand?: () => void;
}

function borderColorFor(state: ToolCardProps['state']): string {
  if (state === 'running') return Colors.accent;
  if (state === 'error') return Colors.accentRed;
  return Colors.accentGreen;
}

function glyphFor(state: ToolCardProps['state']): string {
  if (state === 'running') return '▶';
  if (state === 'error') return '✗';
  return '✓';
}

function ToolCardBase({
  toolName,
  state,
  header,
  children,
  onPress,
  expanded,
  onToggleExpand,
}: ToolCardProps): React.ReactElement {
  const interactive = onPress != null || onToggleExpand != null;
  const handlePress = (): void => {
    if (onPress) onPress();
    if (onToggleExpand) onToggleExpand();
  };

  const headerContent = (
    <View style={styles.headerRow}>
      <Text style={[styles.glyph, { color: borderColorFor(state) }]}>{glyphFor(state)}</Text>
      <Text style={styles.toolName} numberOfLines={1}>
        {toolName}
      </Text>
      <View style={styles.headerSlot}>{header}</View>
      {onToggleExpand && (
        <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
      )}
    </View>
  );

  const showBody = expanded && children != null;

  return (
    <View style={[styles.card, { borderLeftColor: borderColorFor(state) }]}>
      {interactive ? (
        <TouchableOpacity onPress={handlePress} activeOpacity={0.7}>
          {headerContent}
        </TouchableOpacity>
      ) : (
        <View>{headerContent}</View>
      )}
      {showBody && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginVertical: 4,
    borderRadius: 6,
    backgroundColor: Colors.surface,
    borderLeftWidth: 3,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    minHeight: 44,
    gap: 8,
  },
  glyph: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body,
    fontWeight: FontWeight.semiBold,
  },
  toolName: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body,
    color: Colors.textPrimary,
    fontWeight: FontWeight.semiBold,
  },
  headerSlot: {
    flex: 1,
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  chevron: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body,
    color: Colors.textSecondary,
    marginLeft: 4,
  },
  body: {
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
});

export const ToolCard = memo(ToolCardBase);
