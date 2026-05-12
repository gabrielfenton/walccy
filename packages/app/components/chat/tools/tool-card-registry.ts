import React from 'react';
import type { ReactElement } from 'react';
import type { ChatEntryTool } from '../../../stores/messages.store';
import { FallbackCard } from './FallbackCard';

export type ToolCardComponent = React.ComponentType<{ entry: ChatEntryTool }>;

const registry = new Map<string, ToolCardComponent>();

export function registerToolCard(name: string, component: ToolCardComponent): void {
  registry.set(name, component);
}

export function getToolCard(name: string): ToolCardComponent | null {
  return registry.get(name) ?? null;
}

export function renderToolCard(entry: ChatEntryTool): ReactElement {
  const Component = registry.get(entry.toolName) ?? FallbackCard;
  return React.createElement(Component, { entry, key: entry.id });
}
