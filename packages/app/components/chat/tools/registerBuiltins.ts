import { registerToolCard } from './tool-card-registry';
import { BashCard } from './BashCard';

// F10..F18 add their cards here via registerToolCard / registerToolCardPattern.
export function registerAllToolCards(): void {
  registerToolCard('Bash', BashCard);
}
