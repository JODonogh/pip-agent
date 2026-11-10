import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { LEARN_BODY } from './banner';

// Exercise the webview's actual message and click handlers without an editor host.
class Node {
  children: Node[] = [];
  value = '';
  disabled = false;
  className = '';
  style = {};
  dataset = {};
  open = false;
  onclick?: (event: unknown) => void;
  attrs: Record<string, string> = {};
  listeners: Record<string, ((event: any) => void)[]> = {};
  ownText = '';
  constructor(readonly tagName = 'div') {}
  set textContent(text: string) { this.ownText = String(text); this.children = []; }
  get textContent(): string { return this.ownText + this.children.map((child) => child.textContent).join(''); }
  get classList() {
    return {
      contains: (name: string) => this.className.split(' ').includes(name),
      add: (name: string) => { this.className += ` ${name}`; },
      remove: (name: string) => { this.className = this.className.split(' ').filter((part) => part !== name).join(' '); },
      toggle: (name: string, force: boolean) => {
        const parts = new Set(this.className.split(' ').filter(Boolean));
        if (force) parts.add(name); else parts.delete(name);
        this.className = [...parts].join(' ');
      },
    };
  }
  appendChild(child: Node): Node {
    if (child.tagName === '#fragment') this.children.push(...child.children);
    else this.children.push(child);
    return child;
  }
  append(...children: Node[]) { children.forEach((child) => this.appendChild(child)); }
  replaceChildren(...children: Node[]) { this.children = []; this.ownText = ''; this.append(...children); }
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  addEventListener(type: string, handler: (event: any) => void) { (this.listeners[type] ??= []).push(handler); }
  focus() {}
  contains(node: Node): boolean { return this === node || this.children.some((child) => child.contains(node)); }
}

function nodes(root: Node): Node[] { return [root, ...root.children.flatMap(nodes)]; }
function webview() {
  const ids = new Map<string, Node>();
  const posted: Record<string, unknown>[] = [];
  const handlers: ((event: unknown) => void)[] = [];
  const get = (id: string) => {
    if (!ids.has(id)) ids.set(id, new Node());
    return ids.get(id)!;
  };
  const context = createContext({
    acquireVsCodeApi: () => ({ postMessage: (msg: Record<string, unknown>) => posted.push(msg) }),
    window: { addEventListener: (type: string, handler: (event: unknown) => void) => { if (type === 'message') handlers.push(handler); }, innerWidth: 700 },
    document: {
      getElementById: get, querySelectorAll: () => [], addEventListener: () => {},
      createElement: (tag: string) => new Node(tag),
      createTextNode: (text: string) => { const node = new Node('#text'); node.textContent = text; return node; },
      createDocumentFragment: () => new Node('#fragment'),
    },
    setTimeout, clearTimeout, setInterval, clearInterval,
  });
  runInContext(readFileSync(resolve('media/learn.js'), 'utf8'), context);
  return {
    get, posted, context,
    click: (id: string) => get(id).listeners.click?.forEach((fn) => fn({})),
    message: (data: unknown) => handlers.forEach((handler) => handler({ data })),
  };
}

describe('Ideation webview', () => {
  it('uses concise labels and removes randomise', () => {
    expect(LEARN_BODY).toContain('<strong>Improve</strong>');
    expect(LEARN_BODY).toContain('>Spot improvements</button>');
    expect(LEARN_BODY).toContain('>Diverge</button>');
    expect(LEARN_BODY).toContain('data-lens="Metaphor">Metaphor</button>');
    expect(LEARN_BODY).toContain('data-lens="Subtraction">Subtract</button>');
    expect(LEARN_BODY).toContain('data-lens="Reverse">Reverse</button>');
    expect(LEARN_BODY).not.toMatch(/randomise|exploding JIRAs|Innovative POC Studio/i);
  });

  it('opens an idea question box and ignores an unrelated reply', () => {
    const ui = webview();
    ui.message({ type: 'improvements', ideas: [{ id: 'idea-1', title: 'Test the branch', category: 'Tests', why: 'A boundary is visible.', change: 'Try both cases.', effort: 'XS', verification: { level: 'Speculation', challenge: 'Coverage is unknown.', check: 'Inspect the tests.' } }] });
    const ask = nodes(ui.get('improveResult')).find((node) => node.tagName === 'button' && node.textContent === 'Ask')!;
    ask.onclick?.({});
    expect(ui.get('ideaHelpTitle').textContent).toBe('Test the branch');
    expect(ui.get('ideaHelpAnswer').textContent).toContain('Ask about this idea');
    ui.get('ideaHelpQuestion').value = 'What evidence would confirm it?';
    ui.click('ideaHelpSubmit');
    const request = ui.posted.at(-1)!;
    expect(request).toMatchObject({ type: 'ideaHelp', id: 'idea-1', mode: 'ask', question: 'What evidence would confirm it?' });
    expect(ui.get('ideaHelpSubmit').disabled).toBe(true);
    ui.message({ type: 'ideaHelpReply', id: 'other', requestId: request.requestId, text: 'Wrong response' });
    expect(ui.get('ideaHelpAnswer').textContent).not.toContain('Wrong response');
    ui.message({ type: 'ideaHelpReply', id: 'idea-1', requestId: request.requestId, text: 'Compare a boundary case with its neighbouring value.' });
    expect(ui.get('ideaHelpAnswer').textContent).toContain('boundary case');
    expect(ui.get('ideaHelpSubmit').disabled).toBe(false);
  });

  it('teaches how to spot an idea and blocks planning refuted ideas', () => {
    const ui = webview();
    ui.message({ type: 'pocIdeasResult', pocs: [{ id: 'experiment-1', title: 'Measure UUID cost', hook: 'Compare before and after.', hypothesis: 'The cost might matter.', slice: 'One benchmark.', demo: 'Median time.', verification: { level: 'Refuted', evidence: 'UUID.randomUUID()', challenge: 'Converting to String is not a cheaper UUID.', check: 'Measure allocations.' } }] });
    const buttons = nodes(ui.get('pocResult')).filter((node) => node.tagName === 'button');
    expect(buttons.find((node) => node.textContent === 'Plan experiment')?.disabled).toBe(true);
    expect(ui.get('pocResult').textContent).toContain('Not recommended');
    expect(ui.get('pocResult').textContent).toContain('Success measure: Median time.');
    buttons.find((node) => node.textContent === 'How to spot this')!.onclick?.({});
    expect(ui.posted.at(-1)).toMatchObject({ type: 'ideaHelp', id: 'experiment-1', mode: 'learn' });
    ui.click('ideaHelpClose');
    expect(ui.get('ideaHelpDialog').classList.contains('hidden')).toBe(true);
  });

  it('shows empty-result explanations and recovers generation controls after errors', () => {
    const ui = webview();
    ui.click('improveBtn');
    expect(ui.get('improveBtn').disabled).toBe(true);
    ui.message({ type: 'improvements', ideas: [], note: 'Model unavailable; no ideas were assessed.' });
    expect(ui.get('improveResult').textContent).toContain('Model unavailable');
    expect(ui.get('improveBtn').disabled).toBe(false);
    ui.click('pocIdeasBtn');
    ui.message({ type: 'ideationError', target: 'pocIdeas', text: 'Select code first.' });
    expect(ui.get('pocResult').textContent).toBe('Select code first.');
    expect(ui.get('pocIdeasBtn').disabled).toBe(false);
  });

  it('offers questions on diverged alternatives and metaphor suggestions', () => {
    const ui = webview();
    ui.message({ type: 'approaches', approaches: ['Use a local cache'], ideaIds: ['alternative-1'] });
    nodes(ui.get('innovatorResult')).find((node) => node.tagName === 'button' && node.textContent === 'How to spot this')!.onclick?.({});
    expect(ui.posted.at(-1)).toMatchObject({ id: 'alternative-1', mode: 'learn' });
    ui.message({ type: 'scamperResult', lens: 'Metaphor', text: 'A checkpoint checks each pass.', ideaId: 'metaphor-1' });
    const asks = nodes(ui.get('innovatorResult')).filter((node) => node.tagName === 'button' && node.textContent === 'Ask');
    asks.at(-1)!.onclick?.({});
    expect(ui.get('ideaHelpTitle').textContent).toBe('Metaphor');
  });
});
