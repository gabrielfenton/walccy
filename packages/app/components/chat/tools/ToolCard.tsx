import React, { memo } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../../constants/typography';

export type ToolCardChipTone = 'neutral' | 'accent' | 'good' | 'bad' | 'warn';

export interface ToolCardChip {
  text: string;
  tone: ToolCardChipTone;
  /** Default true — chips are usually mono data. Set false for UI labels. */
  mono?: boolean;
}

export interface ToolCardHeaderData {
  /** Primary identity text (basename, hostname, command, query). Always mono dim caption. */
  identity?: string;
  /** Small chips after identity. */
  chips?: ToolCardChip[];
  /** One-line plain text rendered RED in place of chips when state === 'error'. */
  errorSummary?: string;
  /** Optional variant-owned trailing slot (e.g. Answer / Accept-Reject buttons). */
  action?: ReactNode;
}

export interface ToolCardProps {
  toolName: string;
  state: 'running' | 'complete' | 'error';
  header?: ToolCardHeaderData;
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

interface ToneColors {
  fg: string;
  bg: string;
}

function toneColors(tone: ToolCardChipTone): ToneColors {
  switch (tone) {
    case 'accent':
      return { fg: Colors.accent, bg: Colors.accent + '22' };
    case 'good':
      return { fg: Colors.accentGreen, bg: Colors.accentGreen + '22' };
    case 'bad':
      return { fg: Colors.accentRed, bg: Colors.accentRed + '22' };
    case 'warn':
      return { fg: Colors.accentAmber, bg: Colors.accentAmber + '22' };
    case 'neutral':
    default:
      return { fg: Colors.textSecondary, bg: 'transparent' };
  }
}

function Chip({ chip }: { chip: ToolCardChip }): React.ReactElement {
  const { fg, bg } = toneColors(chip.tone);
  const mono = chip.mono !== false;
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text
        style={[
          mono ? styles.chipTextMono : styles.chipTextUi,
          { color: fg },
        ]}
        numberOfLines={1}
      >
        {chip.text}
      </Text>
    </View>
  );
}

function HeaderContent({
  state,
  header,
}: {
  state: ToolCardProps['state'];
  header?: ToolCardHeaderData;
}): React.ReactElement | null {
  if (state === 'running') return null;
  if (header == null) return null;

  if (state === 'error' && header.errorSummary != null && header.errorSummary.length > 0) {
    return (
      <Text style={styles.errorSummary} numberOfLines={1}>
        {`✗ ${header.errorSummary}`}
      </Text>
    );
  }

  const hasIdentity = typeof header.identity === 'string' && header.identity.length > 0;
  const chips = header.chips ?? [];
  if (!hasIdentity && chips.length === 0) return null;

  return (
    <View style={styles.headerInner}>
      {hasIdentity && (
        <Text style={styles.identity} numberOfLines={1}>
          {header.identity}
        </Text>
      )}
      {chips.map((c, i) => (
        <Chip key={`${c.text}-${i}`} chip={c} />
      ))}
    </View>
  );
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

  const showAction =
    header?.action != null &&
    state !== 'running' &&
    !(state === 'error' && header.errorSummary != null && header.errorSummary.length > 0);

  const headerContent = (
    <View style={styles.headerRow}>
      <Text style={[styles.glyph, { color: borderColorFor(state) }]}>{glyphFor(state)}</Text>
      <Text style={styles.toolName} numberOfLines={1}>
        {toolName}
      </Text>
      <View style={styles.headerSlot}>
        <HeaderContent state={state} header={header} />
      </View>
      {showAction && <View style={styles.actionSlot}>{header!.action}</View>}
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
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  identity: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
    maxWidth: 200,
  },
  chip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  chipTextMono: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semiBold,
  },
  chipTextUi: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semiBold,
  },
  errorSummary: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
    color: Colors.accentRed,
    maxWidth: 240,
  },
  actionSlot: {
    flexDirection: 'row',
    gap: 6,
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
