import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { expect, it } from 'vitest';

class Element {
  children: Element[] = [];
  textContent = '';
  className = '';
  value = '';
  style = {};
  onclick?: () => void;
  onchange?: () => void;
  constructor(readonly tag: string) {}
  append(...children: Element[]) { this.children.push(...children); }
  appendChild(child: Element) { this.append(child); }
  replaceChildren(...children: Element[]) { this.children = children; }
  setAttribute() {}
}
const all = (node: Element): Element[] => [node, ...node.children.flatMap(all)];

it('filters saved cards by layer and sends an explicit layer change', () => {
  const cards = new Element('div');
  const handlers: ((event: { data: unknown }) => void)[] = [];
  const posts: unknown[] = [];
  runInContext(readFileSync('media/sidebar.js', 'utf8'), createContext({
    window: { pipPost: (msg: unknown) => posts.push(msg), addEventListener: (_type: string, fn: typeof handlers[number]) => handlers.push(fn) },
    document: { getElementById: (id: string) => id === 'cards' ? cards : new Element('div'), createElement: (tag: string) => new Element(tag) },
    clearTimeout, setTimeout,
  }));
  handlers[0]!({ data: { type: 'concepts', concepts: [
    { id: 'a', term: 'Transaction', layer: 'data', status: 'new', statusLabel: 'New', file: 'a.sql', line: 1 },
    { id: 'b', term: 'UI state', layer: 'frontend', status: 'new', statusLabel: 'New', file: 'b.tsx', line: 1 },
  ] } });
  all(cards).find(node => node.tag === 'button' && node.textContent === 'Data & persistence')!.onclick!();
  const shown = all(cards).filter(node => node.className.includes('flashcard'));
  expect(shown).toHaveLength(1);
  expect(all(shown[0]!).some(node => node.textContent === 'Transaction')).toBe(true);
  expect(all(shown[0]!).some(node => node.tag === 'select')).toBe(false);
});
