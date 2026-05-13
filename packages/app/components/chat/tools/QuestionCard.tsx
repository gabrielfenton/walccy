// ──────────────────────────────────────────────
// QuestionCard — interactive card for the SDK AskUserQuestion tool
// ──────────────────────────────────────────────

import React, { memo, useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ChatEntryTool } from '../../../stores/messages.store';
import { Colors } from '../../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../../constants/typography';
import { ToolCard, type ToolCardHeaderData } from './ToolCard';
import { firstLine, resultToText, truncate } from './cardFormat';
import { FallbackCard } from './FallbackCard';
import { wsClient } from '../../../services/ws-client';

interface QuestionCardProps {
  entry: ChatEntryTool;
  sessionId: string;
}

interface QuestionOption {
  label: string;
  description: string;
  preview?: string;
}

interface Question {
  question: string;
  header: string;
  multiSelect: boolean;
  options: QuestionOption[];
}

function parseQuestions(input: unknown): Question[] | null {
  if (input == null || typeof input !== 'object') return null;
  const raw = (input as { questions?: unknown }).questions;
  if (!Array.isArray(raw)) return null;
  const out: Question[] = [];
  for (const q of raw) {
    if (q == null || typeof q !== 'object') return null;
    const qq = q as Record<string, unknown>;
    if (typeof qq.question !== 'string') return null;
    if (typeof qq.header !== 'string') return null;
    if (typeof qq.multiSelect !== 'boolean') return null;
    if (!Array.isArray(qq.options)) return null;
    const opts: QuestionOption[] = [];
    for (const o of qq.options) {
      if (o == null || typeof o !== 'object') return null;
      const oo = o as Record<string, unknown>;
      if (typeof oo.label !== 'string') return null;
      if (typeof oo.description !== 'string') return null;
      const preview = typeof oo.preview === 'string' ? oo.preview : undefined;
      opts.push({ label: oo.label, description: oo.description, preview });
    }
    out.push({
      question: qq.question,
      header: qq.header,
      multiSelect: qq.multiSelect,
      options: opts,
    });
  }
  return out;
}

function QuestionCardBase({ entry, sessionId }: QuestionCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(true);
  const [selections, setSelections] = useState<Record<number, Set<string>>>({});
  const [submitted, setSubmitted] = useState(false);

  const onToggle = useCallback(() => setExpanded((v) => !v), []);

  const questions = useMemo(() => parseQuestions(entry.input), [entry.input]);

  const resultText = useMemo(() => resultToText(entry.result), [entry.result]);

  const awaiting = entry.state === 'running' && !submitted;

  const allAnswered = useMemo(() => {
    if (questions == null) return false;
    for (let i = 0; i < questions.length; i++) {
      const sel = selections[i];
      if (sel == null || sel.size === 0) return false;
    }
    return true;
  }, [questions, selections]);

  const toggleOption = useCallback(
    (qIndex: number, label: string, multi: boolean) => {
      if (submitted || entry.state !== 'running') return;
      setSelections((prev) => {
        const next: Record<number, Set<string>> = { ...prev };
        const existing = next[qIndex] ?? new Set<string>();
        if (multi) {
          const updated = new Set(existing);
          if (updated.has(label)) updated.delete(label);
          else updated.add(label);
          next[qIndex] = updated;
        } else {
          next[qIndex] = new Set([label]);
        }
        return next;
      });
    },
    [submitted, entry.state],
  );

  const onSubmit = useCallback(() => {
    if (questions == null) return;
    if (!allAnswered) return;
    const answers: string[] = questions.map((q, i) => {
      const sel = selections[i];
      if (sel == null || sel.size === 0) return '';
      const labels = Array.from(sel);
      return q.multiSelect ? labels.join(', ') : (labels[0] ?? '');
    });
    wsClient.answerQuestion(sessionId, entry.toolUseId, answers);
    setSubmitted(true);
  }, [questions, selections, allAnswered, sessionId, entry.toolUseId]);

  const header = useMemo<ToolCardHeaderData>(() => {
    if (questions == null || questions.length === 0) return {};
    let identity = truncate(questions[0]!.header, 24);
    if (questions.length > 1) {
      identity = `${identity} (+${questions.length - 1} more)`;
    }
    let errorSummary: string | undefined;
    if (entry.state === 'error') {
      const line = firstLine(resultText).trim();
      if (line.length > 0) errorSummary = truncate(line, 80);
    }
    const action =
      awaiting ? (
        <TouchableOpacity
          onPress={allAnswered ? onSubmit : undefined}
          activeOpacity={allAnswered ? 0.75 : 1}
          disabled={!allAnswered}
          style={[styles.headerAction, !allAnswered && styles.headerActionDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Send answers"
        >
          <Text style={styles.headerActionText}>Send</Text>
        </TouchableOpacity>
      ) : undefined;
    return { identity, errorSummary, action };
  }, [questions, entry.state, resultText, awaiting, allAnswered, onSubmit]);

  if (questions == null) {
    return <FallbackCard entry={entry} sessionId={sessionId} />;
  }

  const showSubmitInBody = awaiting;
  const showAnsweredStatus = submitted || entry.state !== 'running';

  return (
    <ToolCard
      toolName={entry.toolName}
      state={entry.state}
      header={header}
      expanded={expanded}
      onToggleExpand={onToggle}
    >
      <View>
        {questions.map((q, i) => {
          const sel = selections[i] ?? new Set<string>();
          return (
            <View key={`q-${i}`} style={i > 0 ? styles.questionSpaced : undefined}>
              <View style={styles.questionHeaderRow}>
                <Text style={styles.questionHeader} numberOfLines={1}>
                  {q.header}
                </Text>
                {q.multiSelect ? (
                  <View style={styles.multiChip}>
                    <Text style={styles.multiChipText}>· multi</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.questionBody} selectable>
                {q.question}
              </Text>
              {q.options.map((opt, j) => {
                const selected = sel.has(opt.label);
                const glyph = q.multiSelect
                  ? selected
                    ? '☑'
                    : '☐'
                  : selected
                    ? '●'
                    : '○';
                const interactable = !submitted && entry.state === 'running';
                const dimUnselectedDescription = showAnsweredStatus && !selected;
                const showPreview = opt.preview != null && selected;
                return (
                  <TouchableOpacity
                    key={`opt-${i}-${j}`}
                    style={styles.optionRow}
                    onPress={
                      interactable
                        ? () => toggleOption(i, opt.label, q.multiSelect)
                        : undefined
                    }
                    disabled={!interactable}
                    activeOpacity={interactable ? 0.65 : 1}
                    accessibilityRole="button"
                    accessibilityLabel={`${selected ? 'Selected: ' : ''}${opt.label}`}
                  >
                    <Text
                      style={[
                        styles.optionGlyph,
                        { color: selected ? Colors.accent : Colors.textSecondary },
                      ]}
                    >
                      {glyph}
                    </Text>
                    <View style={styles.optionTextWrap}>
                      <Text
                        style={[
                          styles.optionLabel,
                          selected && styles.optionLabelSelected,
                          dimUnselectedDescription && styles.optionLabelDim,
                        ]}
                      >
                        {opt.label}
                      </Text>
                      {!dimUnselectedDescription && opt.description.length > 0 ? (
                        <Text style={styles.optionDescription} selectable>
                          {opt.description}
                        </Text>
                      ) : null}
                      {showPreview ? (
                        <>
                          <Text style={styles.previewLabel}>preview</Text>
                          <ScrollView style={styles.previewScroll} nestedScrollEnabled>
                            <Text style={styles.previewText} selectable>
                              {opt.preview}
                            </Text>
                          </ScrollView>
                        </>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })}

        {showSubmitInBody ? (
          <View style={styles.submitRow}>
            <TouchableOpacity
              style={[styles.submitBtn, !allAnswered && styles.submitBtnDisabled]}
              onPress={allAnswered ? onSubmit : undefined}
              disabled={!allAnswered}
              activeOpacity={allAnswered ? 0.8 : 1}
              accessibilityRole="button"
              accessibilityLabel="Submit answers"
            >
              <Text style={styles.submitText}>Submit</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {showAnsweredStatus ? (
          <Text style={styles.answeredStatus}>Answered</Text>
        ) : null}
      </View>
    </ToolCard>
  );
}

const styles = StyleSheet.create({
  questionSpaced: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  questionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  questionHeader: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semiBold,
    color: Colors.textSecondary,
    flexShrink: 1,
  },
  multiChip: {
    paddingHorizontal: 4,
  },
  multiChipText: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
    fontStyle: 'italic',
  },
  questionBody: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  optionGlyph: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body,
    fontWeight: FontWeight.bold,
    width: 18,
    textAlign: 'center',
    marginTop: 1,
  },
  optionTextWrap: {
    flex: 1,
  },
  optionLabel: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    color: Colors.textPrimary,
    fontWeight: FontWeight.medium,
  },
  optionLabelSelected: {
    color: Colors.accent,
    fontWeight: FontWeight.semiBold,
  },
  optionLabelDim: {
    color: Colors.textSecondary,
    fontWeight: FontWeight.regular,
  },
  optionDescription: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  previewLabel: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semiBold,
    color: Colors.textSecondary,
    marginTop: 6,
    marginBottom: 3,
  },
  previewScroll: {
    maxHeight: 200,
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  previewText: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body - 2,
    color: Colors.textPrimary,
  },
  submitRow: {
    marginTop: 14,
  },
  submitBtn: {
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  submitBtnDisabled: {
    opacity: 0.4,
  },
  submitText: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.bold,
    color: '#FFFFFF',
  },
  answeredStatus: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontStyle: 'italic',
    color: Colors.accentGreen,
    marginTop: 10,
    textAlign: 'center',
  },
  headerAction: {
    minHeight: 32,
    minWidth: 56,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActionDisabled: {
    opacity: 0.4,
  },
  headerActionText: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.bold,
    color: '#FFFFFF',
  },
});

export const QuestionCard = memo(QuestionCardBase);
