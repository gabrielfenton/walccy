// ──────────────────────────────────────────────
// AssistantMessage — left-aligned, markdown-rendered claude message
// ──────────────────────────────────────────────
//
// Renders streaming and final assistant text. Uses react-native-markdown-display
// for the prose; for now we accept the lib's default styling and override
// colors / fonts via the `style` prop. While `streaming:true`, a thin
// purple caret blinks at ~600ms after the trailing text.

import React, { memo, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize } from '../../constants/typography';

interface AssistantMessageProps {
  text: string;
  streaming: boolean;
}

function AssistantMessageBase({
  text,
  streaming,
}: AssistantMessageProps): React.ReactElement {
  const mdStyles = useMemo(() => markdownStyles, []);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!streaming) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 300,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 300,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [streaming, opacity]);

  return (
    <View style={styles.row}>
      <View style={styles.body}>
        {text.length === 0 && !streaming ? (
          <Text style={styles.placeholder}>…</Text>
        ) : (
          <View style={styles.inlineWrap}>
            {text.length > 0 && <Markdown style={mdStyles}>{text}</Markdown>}
            {streaming && (
              <View style={styles.caretRow}>
                <Animated.View style={[styles.caret, { opacity }]} />
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

export const AssistantMessage = memo(AssistantMessageBase);

const CARET_HEIGHT = Math.round(FontSize.body * 1.2);

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 12,
    marginTop: 4,
    marginBottom: 8,
  },
  body: {
    paddingHorizontal: 4,
  },
  inlineWrap: {
    flexDirection: 'column',
  },
  caretRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: CARET_HEIGHT,
    marginTop: -4,
  },
  caret: {
    width: 2,
    height: CARET_HEIGHT,
    backgroundColor: Colors.accent,
    borderRadius: 1,
  },
  placeholder: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
  },
});

// react-native-markdown-display takes a record of node-typed styles. We
// override the visible ones; defaults remain for less-common nodes.
// Using `as any` because the lib's TS types do not include every node key.
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
