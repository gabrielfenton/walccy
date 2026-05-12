import React from 'react';
import type { ReactElement } from 'react';
import type { ChatEntryTool } from '../../../stores/messages.store';
import { FallbackCard } from './FallbackCard';

export type ToolCardComponent = React.ComponentType<{ entry: ChatEntryTool }>;
export type ToolCardPredicate = (toolName: string) => boolean;

const registry = new Map<string, ToolCardComponent>();
const patterns: Array<{ predicate: ToolCardPredicate; component: ToolCardComponent }> = [];

export function registerToolCard(name: string, component: ToolCardComponent): void {
  registry.set(name, component);
}

export function registerToolCardPattern(
  predicate: ToolCardPredicate,
  component: ToolCardComponent,
): void {
  patterns.push({ predicate, component });
}

export function getToolCard(name: string): ToolCardComponent | null {
  return registry.get(name) ?? null;
}

export function renderToolCard(entry: ChatEntryTool): ReactElement {
  const exact = registry.get(entry.toolName);
  const Component =
    exact ?? patterns.find((p) => p.predicate(entry.toolName))?.component ?? FallbackCard;
  return React.createElement(Component, { entry });
}
