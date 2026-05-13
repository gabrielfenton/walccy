// ──────────────────────────────────────────────
// PlanCard — interactive card for the SDK ExitPlanMode tool
// ──────────────────────────────────────────────

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import type { ChatEntryTool } from '../../../stores/messages.store';
import { Colors } from '../../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../../constants/typography';
import { ToolCard, type ToolCardHeaderData } from './ToolCard';
import { firstLine, isSafeLink, resultToText, stripFormatChars, truncate } from './cardFormat';
import { wsClient } from '../../../services/ws-client';

interface PlanCardProps {
  entry: ChatEntryTool;
  sessionId: string;
}

function readPlan(input: unknown): string {
  if (input == null || typeof input !== 'object') return '';
  const p = (input as { plan?: unknown }).plan;
  return typeof p === 'string' ? stripFormatChars(p) : '';
}

function PlanCardBase({ entry, sessionId }: PlanCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(true);
  const [decided, setDecided] = useState<'accepted' | 'rejected' | null>(null);

  const onToggle = useCallback(() => setExpanded((v) => !v), []);

  // The reducer replaces a tool entry on repeat tool_use (SDK retry).
  // When that happens entry.state flips back to 'running' — reset local
  // decision state so the user can decide again on the new plan.
  useEffect(() => {
    if (entry.state === 'running' && decided !== null) {
      setDecided(null);
    }
  }, [entry.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = useMemo(() => readPlan(entry.input), [entry.input]);

  const resultText = useMemo(() => resultToText(entry.result), [entry.result]);

  const onAccept = useCallback(() => {
    wsClient.planAccept(sessionId, entry.toolUseId);
    setDecided('accepted');
  }, [sessionId, entry.toolUseId]);

  const onReject = useCallback(() => {
    wsClient.planReject(sessionId, entry.toolUseId);
    setDecided('rejected');
  }, [sessionId, entry.toolUseId]);

  // Hold-to-accept: 600ms hold animates an overlay fill from 0→100% width.
  // On press-out before completion we cancel and snap back to 0. On completion
  // (animation `finished === true`) we fire onAccept. Two Animated.Values so
  // the sticky-top and body Accept buttons animate independently.
  const HOLD_MS = 600;
  const holdTopAnim = useRef(new Animated.Value(0)).current;
  const holdBottomAnim = useRef(new Animated.Value(0)).current;
  const holdTopRef = useRef<Animated.CompositeAnimation | null>(null);
  const holdBottomRef = useRef<Animated.CompositeAnimation | null>(null);

  const startHold = useCallback(
    (which: 'top' | 'bottom') => {
      const val = which === 'top' ? holdTopAnim : holdBottomAnim;
      const animRef = which === 'top' ? holdTopRef : holdBottomRef;
      val.setValue(0);
      const anim = Animated.timing(val, {
        toValue: 1,
        duration: HOLD_MS,
        useNativeDriver: false,
      });
      animRef.current = anim;
      anim.start(({ finished }) => {
        if (finished) onAccept();
      });
    },
    [holdTopAnim, holdBottomAnim, onAccept],
  );

  const cancelHold = useCallback(
    (which: 'top' | 'bottom') => {
      const val = which === 'top' ? holdTopAnim : holdBottomAnim;
      const animRef = which === 'top' ? holdTopRef : holdBottomRef;
      if (animRef.current) {
        animRef.current.stop();
        animRef.current = null;
      }
      val.setValue(0);
    },
    [holdTopAnim, holdBottomAnim],
  );

  const fillWidthTop = holdTopAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });
  const fillWidthBottom = holdBottomAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const header = useMemo<ToolCardHeaderData>(() => {
    let errorSummary: string | undefined;
    if (entry.state === 'error') {
      const line = firstLine(resultText).trim();
      if (line.length > 0) errorSummary = truncate(line, 80);
    }
    return {
      chips: [{ text: 'Plan', tone: 'neutral', mono: true }],
      errorSummary,
    };
  }, [entry.state, resultText]);

  const showButtons = decided === null && entry.state === 'running';
  const showStatusRow = !showButtons;

  // Disambiguate user-rejection from tool error. The SDK never tells us "user
  // rejected" — the daemon just sends plan_reject; the tool may then complete
  // (because the model handled rejection) or fail for unrelated reasons. So
  // trust `decided` first; only fall back to entry.state when the user hasn't
  // decided locally.
  let statusKind: 'accepted' | 'rejected' | 'failed' | null = null;
  if (decided === 'accepted') statusKind = 'accepted';
  else if (decided === 'rejected') statusKind = 'rejected';
  else if (entry.state === 'complete') statusKind = 'accepted';
  else if (entry.state === 'error') statusKind = 'failed';

  return (
    <ToolCard
      toolName={entry.toolName}
      state={entry.state}
      header={header}
      expanded={expanded}
      onToggleExpand={onToggle}
    >
      <View>
        {showButtons ? (
          <View style={styles.stickyRow}>
            <TouchableOpacity
              style={styles.stickyRejectBtn}
              onPress={onReject}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Reject plan"
            >
              <Text style={styles.rejectText}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.stickyAcceptBtn}
              onPressIn={() => startHold('top')}
              onPressOut={() => cancelHold('top')}
              activeOpacity={1}
              accessibilityRole="button"
              accessibilityLabel="Hold to accept plan"
            >
              <Animated.View
                style={[styles.holdFill, { width: fillWidthTop }]}
                pointerEvents="none"
              />
              <Text style={styles.acceptText}>Accept</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <Text style={styles.label}>plan</Text>
        {plan.length === 0 ? (
          <Text style={styles.emptyPlan}>(empty plan)</Text>
        ) : (
          <ScrollView style={styles.planScroll} nestedScrollEnabled>
            <Markdown style={markdownStyles} onLinkPress={(url: string) => isSafeLink(url)}>
              {plan}
            </Markdown>
          </ScrollView>
        )}

        {showButtons ? (
          <View>
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.rejectBtn}
                onPress={onReject}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Reject plan"
              >
                <Text style={styles.rejectText}>Reject</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.acceptBtn}
                onPressIn={() => startHold('bottom')}
                onPressOut={() => cancelHold('bottom')}
                activeOpacity={1}
                accessibilityRole="button"
                accessibilityLabel="Hold to accept plan"
              >
                <Animated.View
                  style={[styles.holdFill, { width: fillWidthBottom }]}
                  pointerEvents="none"
                />
                <Text style={styles.acceptText}>Accept</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.holdHint}>Hold to accept</Text>
          </View>
        ) : null}

        {showStatusRow && statusKind === 'accepted' ? (
          <View style={styles.statusRow}>
            <Text style={styles.statusAccepted}>✓ Accepted</Text>
          </View>
        ) : null}
        {showStatusRow && statusKind === 'rejected' ? (
          <View style={styles.statusRow}>
            <Text style={styles.statusRejected}>✗ Rejected</Text>
          </View>
        ) : null}
        {showStatusRow && statusKind === 'failed' ? (
          <View style={styles.statusRow}>
            <Text style={styles.statusFailed}>! Plan failed</Text>
          </View>
        ) : null}
      </View>
    </ToolCard>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semiBold,
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  emptyPlan: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontStyle: 'italic',
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  planScroll: {
    maxHeight: 480,
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  rejectBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: Colors.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.accentRed + '88',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  rejectText: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.semiBold,
    color: Colors.textSecondary,
  },
  acceptBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: Colors.accentGreen,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  // Sticky top decision row — thinner than the bottom row, same colors.
  stickyRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  stickyRejectBtn: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.accentRed + '88',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  stickyAcceptBtn: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.accentGreen,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  // Overlay rendered behind the button label; width animates 0→100%.
  // Uses a darker green tint so progress is visible against the green button.
  holdFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#00000033',
  },
  holdHint: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontStyle: 'italic',
    color: Colors.textSecondary,
    textAlign: 'right',
    marginTop: 4,
  },
  acceptText: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.bold,
    color: '#FFFFFF',
  },
  statusRow: {
    marginTop: 12,
    alignItems: 'center',
  },
  statusAccepted: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.bold,
    color: Colors.accentGreen,
  },
  statusRejected: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.bold,
    color: Colors.accentRed,
  },
  statusFailed: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.bold,
    color: Colors.accentAmber,
  },
});

// Mirrors AssistantMessage's markdownStyles. Kept locally to avoid coupling
// a new shared module; identical key/value choices so plan prose reads the
// same as assistant prose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const markdownStyles: any = {
  body: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    lineHeight: FontSize.body * 1.45,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 8,
  },
  heading1: { color: Colors.textPrimary, fontSize: FontSize.title, marginTop: 8, marginBottom: 6 },
  heading2: { color: Colors.textPrimary, fontSize: FontSize.heading, marginTop: 8, marginBottom: 6 },
  heading3: { color: Colors.textPrimary, fontSize: FontSize.heading, marginTop: 6, marginBottom: 4 },
  strong: { color: Colors.textPrimary, fontWeight: '700' as const },
  em: { color: Colors.textPrimary, fontStyle: 'italic' as const },
  link: { color: Colors.accent, textDecorationLine: 'underline' as const },
  bullet_list: { marginTop: 2, marginBottom: 8 },
  ordered_list: { marginTop: 2, marginBottom: 8 },
  list_item: { marginBottom: 2 },
  code_inline: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body - 1,
    color: Colors.textMono,
    backgroundColor: Colors.surface,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  code_block: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body - 1,
    color: Colors.textMono,
    backgroundColor: Colors.surface,
    padding: 10,
    borderRadius: 8,
    marginVertical: 6,
  },
  fence: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body - 1,
    color: Colors.textMono,
    backgroundColor: Colors.surface,
    padding: 10,
    borderRadius: 8,
    marginVertical: 6,
  },
  blockquote: {
    backgroundColor: Colors.surface,
    borderLeftWidth: 3,
    borderLeftColor: Colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginVertical: 6,
  },
  hr: {
    backgroundColor: Colors.border,
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
  },
};

export const PlanCard = memo(PlanCardBase);
