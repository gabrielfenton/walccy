import { registerToolCard } from './tool-card-registry';
import { BashCard } from './BashCard';
import { EditCard } from './EditCard';
import { GlobCard } from './GlobCard';
import { GrepCard } from './GrepCard';
import { ReadCard } from './ReadCard';
import { WebFetchCard } from './WebFetchCard';
import { WebSearchCard } from './WebSearchCard';

// F10..F18 add their cards here via registerToolCard / registerToolCardPattern.
export function registerAllToolCards(): void {
  registerToolCard('Bash', BashCard);
  registerToolCard('Edit', EditCard);
  registerToolCard('Glob', GlobCard);
  registerToolCard('Grep', GrepCard);
  registerToolCard('Read', ReadCard);
  registerToolCard('WebFetch', WebFetchCard);
  registerToolCard('WebSearch', WebSearchCard);
}
