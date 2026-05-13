import React, { memo, useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ChatEntryTool } from '../../../stores/messages.store';
import { Colors } from '../../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../../constants/typography';
import { ToolCard } from './ToolCard';

interface TodoCardProps {
  entry: ChatEntryTool;
}

type TodoStatus = 'pending' | 'in_progress' | 'completed';

interface Todo {
  content: string;
  activeForm: string;
  status: TodoStatus;
}

interface TodoInput {
  todos?: unknown;
}

function isTodo(v: unknown): v is Todo {
  if (v == null || typeof v !== 'object') return false;
  const o = v as { content?: unknown; activeForm?: unknown; status?: unknown };
  return (
    typeof o.content === 'string' &&
    typeof o.activeForm === 'string' &&
    (o.status === 'pending' || o.status === 'in_progress' || o.status === 'completed')
  );
}

function TodoCardBase({ entry }: TodoCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(true);
  const onToggle = useCallback(() => setExpanded((v) => !v), []);

  const input = entry.input as TodoInput;
  const todos: Todo[] = useMemo(() => {
    const raw = input.todos;
    if (!Array.isArray(raw)) return [];
    return raw.filter(isTodo);
  }, [input.todos]);

  const { done, total, active } = useMemo(() => {
    let d = 0;
    let a = 0;
    for (const t of todos) {
      if (t.status === 'completed') d += 1;
      else if (t.status === 'in_progress') a += 1;
    }
    return { done: d, total: todos.length, active: a };
  }, [todos]);

  let header: React.ReactNode = null;
  if (entry.state !== 'running' && total > 0) {
    const allDone = done === total;
    header = (
      <View style={styles.headerInner}>
        <Text
          style={[
            styles.chip,
            { color: allDone ? Colors.accentGreen : Colors.textSecondary },
          ]}
        >
          {`${done} done / ${total}`}
        </Text>
        {active > 0 && (
          <Text style={[styles.chip, { color: Colors.accentAmber }]}>
            {`·${active} active`}
          </Text>
        )}
      </View>
    );
  }

  return (
    <ToolCard
      toolName={entry.toolName}
      state={entry.state}
      header={header}
      expanded={expanded}
      onToggleExpand={onToggle}
    >
      {total === 0 ? (
        <Text style={styles.empty}>(no todos)</Text>
      ) : (
        <View>
          {todos.map((t, i) => {
            if (t.status === 'pending') {
              return (
                <View key={i} style={styles.row}>
                  <Text style={[styles.glyph, { color: Colors.textSecondary }]}>○</Text>
                  <Text style={[styles.label, styles.labelPending]} selectable>
                    {t.content}
                  </Text>
                </View>
              );
            }
            if (t.status === 'in_progress') {
              return (
                <View key={i} style={styles.row}>
                  <Text style={[styles.glyph, { color: Colors.accentAmber }]}>◐</Text>
                  <Text style={[styles.label, styles.labelActive]} selectable>
                    {t.activeForm}
                  </Text>
                </View>
              );
            }
            return (
              <View key={i} style={styles.row}>
                <Text style={[styles.glyph, { color: Colors.accentGreen }]}>✓</Text>
                <Text style={[styles.label, styles.labelDone]} selectable>
                  {t.content}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </ToolCard>
  );
}

const styles = StyleSheet.create({
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chip: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semiBold,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 4,
    gap: 8,
  },
  glyph: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.body,
    fontWeight: FontWeight.semiBold,
  },
  label: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    flex: 1,
    flexWrap: 'wrap',
  },
  labelPending: {
    color: Colors.textSecondary,
  },
  labelActive: {
    color: Colors.textPrimary,
    fontWeight: FontWeight.semiBold,
  },
  labelDone: {
    color: Colors.textSecondary,
    textDecorationLine: 'line-through',
  },
  empty: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontStyle: 'italic',
    color: Colors.textSecondary,
  },
});

export const TodoCard = memo(TodoCardBase);
