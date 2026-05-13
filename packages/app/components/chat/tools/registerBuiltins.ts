import { registerToolCard, registerToolCardPattern } from './tool-card-registry';
import { AgentCard } from './AgentCard';
import { BashCard } from './BashCard';
import { EditCard } from './EditCard';
import { GlobCard } from './GlobCard';
import { GrepCard } from './GrepCard';
import { McpToolCard } from './McpToolCard';
import { ReadCard } from './ReadCard';
import { SkillCard } from './SkillCard';
import { TodoCard } from './TodoCard';
import { WebFetchCard } from './WebFetchCard';
import { WebSearchCard } from './WebSearchCard';

// F10..F18 add their cards here via registerToolCard / registerToolCardPattern.
export function registerAllToolCards(): void {
  registerToolCard('Bash', BashCard);
  registerToolCard('Task', AgentCard);
  registerToolCard('Edit', EditCard);
  registerToolCard('Glob', GlobCard);
  registerToolCard('Grep', GrepCard);
  registerToolCard('Read', ReadCard);
  registerToolCard('Skill', SkillCard);
  registerToolCard('TodoWrite', TodoCard);
  registerToolCard('WebFetch', WebFetchCard);
  registerToolCard('WebSearch', WebSearchCard);
  registerToolCardPattern((name) => name.startsWith('mcp__'), McpToolCard);
}
