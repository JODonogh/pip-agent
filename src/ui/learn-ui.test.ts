import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { LEARN_BODY } from './banner';

class Element {
  children: Element[] = [];
  ownText = '';
  attrs: Record<string, string> = {};
  dataset: Record<string, string> = {};
  listeners: Record<string, ((event: any) => void)[]> = {};
  style = {};
  className = '';
  id = '';
  value = '';
  open = false;
  disabled = false;
  title = '';
  onclick?: (event: any) => void;
  constructor(readonly tagName = 'div') {}
  set textContent(value: string) { this.ownText = String(value); this.children = []; }
  get textContent(): string { return this.ownText + this.children.map((child) => child.textContent).join(''); }
  get classList() {
    return {
      contains: (name: string) => this.className.split(' ').includes(name),
      add: (name: string) => { this.className += ` ${name}`; },
      remove: (name: string) => { this.className = this.className.split(' ').filter((part) => part !== name).join(' '); },
      toggle: (name: string, force: boolean) => {
        const values = new Set(this.className.split(' ').filter(Boolean));
        if (force) values.add(name); else values.delete(name);
        this.className = [...values].join(' ');
      },
    };
  }
  appendChild(child: Element) { this.children.push(...(child.tagName === '#fragment' ? child.children : [child])); return child; }
  append(...children: Element[]) { children.forEach((child) => this.appendChild(child)); }
  replaceChildren(...children: Element[]) { this.ownText = ''; this.children = []; this.append(...children); }
  setAttribute(name: string, value: string) { this.attrs[name] = String(value); if (name === 'class') this.className = value; }
  getAttribute(name: string) { return this.attrs[name]; }
  hasAttribute(name: string) { return Object.prototype.hasOwnProperty.call(this.attrs, name); }
  removeAttribute(name: string) { delete this.attrs[name]; }
  addEventListener(type: string, fn: (event: any) => void) { (this.listeners[type] ??= []).push(fn); }
  querySelectorAll(selector: string): Element[] { return descendants(this).slice(1).filter((node) => selector.startsWith('.') ? node.classList.contains(selector.slice(1)) : node.tagName === selector); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0]; }
  remove() {}
  focus() {}
  contains(node: Element): boolean { return descendants(this).includes(node); }
}
function descendants(root: Element): Element[] { return [root, ...root.children.flatMap(descendants)]; }
function webview(initialState: Record<string, unknown> = {}) {
  const ids = new Map<string, Element>();
  const posted: Record<string, unknown>[] = [];
  const handlers: ((event: unknown) => void)[] = [];
  let state = initialState;
  const timeouts: { fn: () => void; ms: number }[] = [];
  const intervals: { fn: () => void; ms: number }[] = [];
  const get = (id: string) => { if (!ids.has(id)) ids.set(id, new Element()); return ids.get(id)!; };
  const deep = ['analogy', 'foundations', 'roots', 'Trade-off: Performance'].map((kind) => {
    const section = new Element('details'); section.setAttribute('data-kind', kind); section.className = 'deepLazy';
    const body = new Element(); body.className = 'deepBody muted'; section.appendChild(body); return section;
  });
  const buttons = ['dataFlow', 'sequence', 'dependencies', 'architecture', 'testing', 'decisions', 'circuit', 'wireframe', 'cartesian', 'context', 'security', 'growth'].map((type) => {
    const button = new Element('button'); button.className = 'diagramTypeBtn'; button.setAttribute('data-type', type); return button;
  });
  const family = new Element('select');
  family.options = ['', 'dataFlow', 'sequence', 'dependencies'].map(value => { const option = new Element('option'); option.value = value; return option; });
  const layers = ['calls', 'params', 'hooks'].map((layer) => { const box = new Element('input'); box.setAttribute('data-layer', layer); return box; });
  const context = createContext({
    acquireVsCodeApi: () => ({ postMessage: (message: Record<string, unknown>) => posted.push(message), getState: () => state, setState: (value: Record<string, unknown>) => { state = value; } }),
    window: { addEventListener: (type: string, fn: (event: unknown) => void) => { if (type === 'message') handlers.push(fn); }, innerWidth: 700 },
    document: {
      getElementById: (id: string) => id === 'learningReviewNote' ? descendants(get('result')).find((node) => node.id === id) : get(id),
      querySelectorAll: (selector: string) => selector === '.deepLazy[data-kind]' ? deep : selector === '.diagramTypeBtn' ? buttons : selector === '.diagramFamilySelect' ? [family] : selector === '.layerToggle:checked' ? layers : [],
      querySelector: (selector: string) => selector === '#diagram .diagramSvg' ? get('diagram').querySelector('.diagramSvg') : undefined,
      addEventListener: () => {},
      createElement: (tag: string) => new Element(tag), createElementNS: (_ns: string, tag: string) => new Element(tag),
      createTextNode: (text: string) => { const node = new Element('#text'); node.textContent = text; return node; },
      createDocumentFragment: () => new Element('#fragment'),
    },
    setTimeout: (fn: () => void, ms: number) => { timeouts.push({ fn, ms }); return timeouts.length; }, clearTimeout: () => {},
    setInterval: (fn: () => void, ms: number) => { intervals.push({ fn, ms }); return intervals.length; }, clearInterval: () => {},
  });
  runInContext(readFileSync('media/learn.js', 'utf8'), context);
  return { get, context, posted, deep, buttons, family, timeouts, intervals, state: () => state, message: (data: unknown) => handlers.forEach((fn) => fn({ data })) };
}
const explanation = { bottomLine: 'Scan the input.', chunks: [{ title: 'The scan', body: 'Every character is inspected.' }], repaired: false };

describe('Learn response lifecycle', () => {
  it('uses Select and keeps the four ideation actions in one compact row', () => {
    expect(LEARN_BODY).toContain('id="explainBtn">Select</button>');
    expect(LEARN_BODY).toMatch(/class="ideationActions">\s*<button[^>]*\bid="divergeBtn"[^>]*>Diverge<\/button>\s*<button[^>]+>Metaphor<\/button>\s*<button[^>]+>Subtract<\/button>\s*<button[^>]+>Reverse<\/button>/);
  });

  it('delivers performance content to the visible deepBody and ignores a previous selection', () => {
    const ui = webview();
    ui.message({ type: 'learningStarted', sessionId: 1 });
    ui.message({ type: 'deepDive', sessionId: 1, kind: 'Trade-off: Performance', explanation });
    expect(ui.deep[3]!.textContent).toContain('Every character is inspected.');
    expect(ui.deep[3]!.dataset.loaded).toBe('1');
    ui.message({ type: 'learningStarted', sessionId: 2 });
    ui.message({ type: 'deepDive', sessionId: 1, kind: 'Trade-off: Performance', explanation });
    expect(ui.deep[3]!.textContent).not.toContain('Every character');
    ui.deep[3]!.open = true;
    ui.deep[3]!.listeners.toggle![0]!({});
    expect(ui.posted.at(-1)).toMatchObject({ type: 'deep', kind: 'Trade-off: Performance', sessionId: 2 });
    ui.message({ type: 'deepStatus', sessionId: 2, kind: 'Trade-off: Performance', state: 'error', text: 'Retry this section.' });
    expect(ui.deep[3]!.dataset.requested).toBeUndefined();
  });

  it('applies a reviewed overview without resetting prepared sections or expanded overview chunks', () => {
    const ui = webview();
    ui.message({ type: 'learningStarted', sessionId: 1 });
    ui.message({ type: 'explanation', sessionId: 1, explanation });
    ui.message({ type: 'deepDive', sessionId: 1, kind: 'foundations', explanation });
    ui.deep[1]!.open = true;
    ui.get('result').querySelectorAll('details')[0]!.open = true;
    ui.message({ type: 'explanationReview', sessionId: 1, status: 'revised', text: 'A source review corrected the safety claim.', explanation: { ...explanation, bottomLine: 'Escape LIKE wildcards; query binding is separate.' } });
    expect(ui.get('result').textContent).toContain('Escape LIKE wildcards');
    expect(ui.get('result').querySelectorAll('details')[0]!.open).toBe(true);
    expect(ui.deep[1]!.open).toBe(true);
    expect(ui.deep[1]!.dataset.loaded).toBe('1');
    expect(ui.deep[1]!.textContent).toContain('Every character');
    ui.message({ type: 'explanationReview', sessionId: 0, status: 'revised', explanation: { ...explanation, bottomLine: 'Stale answer' } });
    expect(ui.get('result').textContent).not.toContain('Stale answer');
  });

  it('highlights a sentence-final LIKE but not filename components', () => {
    const ui = webview();
    const rich = runInContext("rich('SQL patterns use LIKE. Thing.LIKE.java', new Set(['like']))", ui.context) as Element;
    const terms = descendants(rich).filter(node => node.tagName === 'button');
    expect(terms.map(node => node.textContent)).toEqual(['LIKE']);
    terms[0]!.onclick?.({ clientX: 10, clientY: 710 });
    const top = parseFloat((ui.get('wordPopup').style as { top: string }).top);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + 200).toBeLessThanOrEqual(720);
  });

  it('uses SQL LIKE as one glossary term and preserves code backslashes', () => {
    const ui = webview();
    const rich = runInContext("rich('SQL LIKE and `\\\\%`', new Set(['sql like']))", ui.context) as Element;
    const term = descendants(rich).find((node) => node.tagName === 'button')!;
    term.onclick?.({ clientX: 10, clientY: 10 });
    expect(ui.posted.at(-1)).toMatchObject({ type: 'popupExplain', word: 'SQL LIKE' });
    expect(rich.textContent).toContain('\\%');
  });
});

describe('Diagram rendering', () => {
  it('hides unavailable architecture and preserves the source order for sequence sketches', () => {
    const ui = webview();
    const nodes = [{ id: 'branch', kind: 'branch', label: 'if input is blank', detail: 'condition' }, { id: 'call', kind: 'call', label: 'input.trim()', detail: 'trim' }];
    const graph = { nodes, edges: [{ from: 'branch', to: 'call' }], language: 'java' };
    ui.message({ type: 'diagrams', diagrams: { dataFlow: graph, sequence: graph, architecture: { nodes: [nodes[0]], edges: [] }, availableTypes: ['dataFlow', 'sequence'] } });
    expect(ui.buttons[3]!.classList.contains('hidden')).toBe(true);
    ui.buttons[1]!.listeners.click![0]!({});
    expect(runInContext('visibleNodes().map(node => node.id).join(",")', ui.context)).toBe('branch,call');
  });

  it('wraps full long labels and sizes every shape within the SVG viewBox', () => {
    const ui = webview();
    const label = 'if (search == null || search.isBlank()) then return an empty result';
    const graph = { nodes: [{ id: 'branch', kind: 'branch', label, detail: label }], edges: [], language: 'java' };
    ui.message({ type: 'diagrams', diagrams: { dataFlow: graph, availableTypes: ['dataFlow'] } });
    const svg = ui.get('diagram').querySelector('.diagramSvg')!;
    const fullLabel = descendants(svg).find((node) => node.classList.contains('nodeLabel'))!;
    expect(fullLabel.children.length).toBeGreaterThan(1);
    expect(fullLabel.textContent.replace(/\s/g, '')).toBe(label.replace(/\s/g, ''));
    const dimensions = svg.attrs.viewBox!.split(' ').map(Number);
    const polygon = descendants(svg).find((node) => node.tagName === 'polygon')!;
    for (const point of polygon.attrs.points!.split(' ')) {
      const [x, y] = point.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(dimensions[2]!);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(dimensions[3]!);
    }
    expect(ui.get('diagram').textContent).toContain('Excerpt sketch');
  });
});


describe('Visualise workspace', () => {
  it('moves diagrams out of Learn while retaining verification and offers direct diagram and coverage actions', () => {
    const learn = LEARN_BODY.slice(LEARN_BODY.indexOf('data-section="learn"'), LEARN_BODY.indexOf('data-section="visualise"'));
    expect(learn).not.toContain('id="diagramBlock"');
    expect(learn).toContain('id="verifyBlock"');
    expect(LEARN_BODY).toContain('data-mode="visualise">Visualise</button>');
    const ui = webview();
    ui.get('visualiseBtn').listeners.click![0]!({});
    expect(ui.posted.at(-1)).toEqual({ type: 'visualiseSelection', fresh: true });
    ui.get('loadCoverageBtn').listeners.click![0]!({});
    expect(ui.posted.at(-1)).toEqual({ type: 'loadCoverage' });
    ui.message({ type: 'visualiseError', text: 'Select code first.' });
    expect(ui.get('diagram').textContent).toBe('Select code first.');
  });

  it('draws true and false decisions with coverage unknown until a report supplies evidence', () => {
    const ui = webview();
    const nodes = [
      { id: 'if', kind: 'branch', label: 'if (ready)', detail: 'condition', coverageState: 'missed', coverage: { covered: 1, total: 2, source: 'report.xml' } },
      { id: 'yes', kind: 'assert', label: 'True outcome', detail: 'inspect true case' },
      { id: 'no', kind: 'assert', label: 'False outcome', detail: 'inspect false case' },
    ];
    ui.message({ type: 'diagrams', diagrams: { decisions: { nodes, edges: [{ from: 'if', to: 'yes', label: 'true' }, { from: 'if', to: 'no', label: 'false' }] }, availableTypes: ['decisions'] } });
    expect(ui.get('diagram').textContent).toContain('true');
    expect(ui.get('diagram').textContent).toContain('false');
    expect(ui.get('diagram').textContent).toContain('1/2 branches');
    expect(ui.get('diagram').textContent).toContain('unknown');
    const svg = ui.get('diagram').querySelector('.diagramSvg')!;
    expect(descendants(svg).some((node) => node.classList.contains('coverage-missed'))).toBe(true);
    expect(descendants(svg).some((node) => node.classList.contains('coverage-unknown'))).toBe(true);
  });

  it('renders circuit and wireframe references from the supplied graph', () => {
    const ui = webview();
    const nodes = [{ id: 'source', kind: 'method', label: 'Selected code', detail: 'source' }, { id: 'target', kind: 'import', label: 'partnerService', detail: 'visible receiver' }];
    const graph = { nodes, edges: [{ from: 'source', to: 'target' }] };
    ui.message({ type: 'diagrams', diagrams: { circuit: graph, wireframe: graph, availableTypes: ['circuit', 'wireframe'] } });
    expect(ui.get('diagram').querySelector('.circuitDiagram')).toBeDefined();
    expect(ui.get('diagram').textContent).toContain('partnerService');
    ui.buttons[7]!.listeners.click![0]!({});
    expect(ui.get('diagram').querySelector('.wireframeDiagram')).toBeDefined();
    expect(ui.get('diagram').textContent).toContain('Selected code');
  });

  it('keeps an explicit Visualise snapshot when an earlier Learn overview arrives late', () => {
    const ui = webview();
    const newer = { nodes: [{ id: 'new', kind: 'method', label: 'New selection', detail: 'new' }], edges: [] };
    const older = { nodes: [{ id: 'old', kind: 'method', label: 'Old selection', detail: 'old' }], edges: [] };
    ui.message({ type: 'diagrams', openDiagram: true, diagrams: { dataFlow: newer, availableTypes: ['dataFlow'] } });
    ui.message({ type: 'explanation', explanation, diagrams: { dataFlow: older, availableTypes: ['dataFlow'] } });
    expect(ui.get('diagram').textContent).toContain('New selection');
    expect(ui.get('diagram').textContent).not.toContain('Old selection');
  });

  it('asks about the current diagram and ignores stale answers after switching views', () => {
    const ui = webview();
    const graph = { nodes: [{ id: 'm', kind: 'method', label: 'parseStatus()', detail: 'method' }], edges: [] };
    ui.message({ type: 'diagrams', diagrams: { dataFlow: graph, sequence: graph, availableTypes: ['dataFlow', 'sequence'] } });
    ui.get('diagramQuestion').value = 'What does this line represent?';
    ui.get('diagramGoal').value = 'Avoid duplicate requests on expansion';
    ui.get('diagramAskBtn').listeners.click![0]!({});
    const request = ui.posted.at(-1)!;
    expect(request).toMatchObject({ type: 'diagramQuestion', diagramType: 'dataFlow', question: 'What does this line represent?', goal: 'Avoid duplicate requests on expansion' });
    ui.message({ type: 'diagramAnswer', requestId: request.requestId, text: 'It shows a source relationship.' });
    expect(ui.get('diagramAnswer').textContent).toContain('source relationship');
    ui.get('diagramQuestion').value = 'Why?';
    ui.get('diagramGoal').value = 'g'.repeat(700);
    ui.get('diagramAskBtn').listeners.click![0]!({});
    const old = ui.posted.at(-1)!;
    expect(String(old.goal)).toHaveLength(600);
    expect(old.history).toEqual([{ question: 'What does this line represent?', answer: 'It shows a source relationship.' }]);
    ui.buttons[1]!.listeners.click![0]!({});
    ui.message({ type: 'diagramAnswer', requestId: old.requestId, text: 'Stale result' });
    expect(ui.get('diagramAnswer').textContent).not.toContain('Stale result');
    expect(ui.get('diagramAskBtn').disabled).toBe(false);
  });

  it('plots theoretical Cartesian series even when there are no code graph nodes', () => {
    const ui = webview();
    ui.message({ type: 'diagrams', diagrams: { cartesian: { nodes: [], edges: [], xLabel: 'Input n', yLabel: 'Illustrative operations', caption: 'Growth illustration, not a measurement.', series: [{ name: 'n', points: [{ x: 0, y: 0 }, { x: 8, y: 8 }] }] }, availableTypes: ['cartesian'] } });
    expect(ui.get('diagram').querySelector('.cartesianDiagram')).toBeDefined();
    expect(ui.get('diagram').textContent).toContain('Input n');
    expect(ui.get('diagram').textContent).toContain('not a measurement');
    ui.message({ type: 'diagrams', diagrams: { growth: { nodes: [], edges: [], xLabel: 'Input size', yLabel: 'Work units', caption: 'General examples.', series: [{ name: 'n²', description: 'Squared growth', points: [{ x: 1, y: 1 }, { x: 8, y: 64 }] }] }, availableTypes: ['growth'] } });
    expect(ui.get('diagram').querySelector('.cartesianDiagram')).toBeDefined();
    expect(ui.get('diagram').textContent).toContain('Squared growth');
  });

  it('draws query performance as cards and SQL flow nodes with their own labels', () => {
    const ui = webview();
    ui.message({ type: 'diagrams', diagrams: {
      growth: { nodes: [
        { id: 'c0', kind: 'method', label: 'Search with a leading %', tag: 'scans rows', tone: 'risk', snippet: "LOWER(p.partner_name) LIKE '%'", detail: 'A leading % cannot use an ordinary index.' },
        { id: 'c1', kind: 'method', label: 'Check before changing anything', tag: 'next step', tone: 'good', snippet: '', detail: 'Run EXPLAIN (ANALYZE).' },
      ], edges: [], caption: 'Observations, not measurements.' },
      availableTypes: ['growth'] } });
    const text = ui.get('diagram').textContent;
    expect(text).toContain('Search with a leading %');
    expect(text).toContain('SCANS ROWS');
    expect(text).toContain('Run EXPLAIN');
    expect(text).not.toContain('General growth examples');
    ui.message({ type: 'diagrams', diagrams: {
      dataFlow: { nodes: [
        { id: 'p', kind: 'param', tag: 'parameter', label: ':status', detail: 'Bound parameter.' },
        { id: 'f', kind: 'call', tag: 'filter', layer: 'core', label: 'Filter on :status', detail: 'condition' },
        { id: 't', kind: 'method', tag: 'table', label: 'partner p', detail: 'FROM gpp.partner p' },
      ], edges: [{ from: 'p', to: 'f' }, { from: 'f', to: 't' }], caption: 'Data flow of this query.' },
      availableTypes: ['dataFlow'] } });
    const flow = ui.get('diagram').textContent;
    expect(flow).toContain('FILTER');
    expect(flow).toContain('PARAMETER');
    expect(flow).toContain('TABLE');
  });
});


describe('focused controls and feedback', () => {
  it('describes every static button and expandable, and removes the redundant beside action', () => {
    const controls = [...LEARN_BODY.matchAll(/<(button|summary)\b([^>]*)>/g)];
    expect(controls.length).toBeGreaterThan(30);
    // Only icon-only buttons carry a tooltip; text buttons and expandable sections deliberately carry none.
    const iconOnly = (body: string) => !/[A-Za-z]/.test(body.replace(/<[^>]*>/g, '').replace(/&[#\w]+;/g, ''));
    const buttons = [...LEARN_BODY.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
    expect(buttons.filter(([, attrs, body]) => iconOnly(body!)).every(([, attrs]) => /\btitle="[^"]+"/.test(attrs!))).toBe(true);
    expect(buttons.filter(([, attrs, body]) => !iconOnly(body!)).some(([, attrs]) => /\btitle=/.test(attrs!))).toBe(false);
    expect(controls.filter(([, tag]) => tag === 'summary').some(([, , attrs]) => /\btitle=/.test(attrs!))).toBe(false);
    expect(LEARN_BODY).not.toContain('id="openBesideBtn"');
    expect(LEARN_BODY).toContain('id="pipResetBtn"');
    expect(LEARN_BODY).toContain('pip-toolbar-row');
    expect(LEARN_BODY).toContain('CS · design · testing');
    const panelCss = readFileSync('media/panel.css', 'utf8');
    expect(panelCss).toMatch(/\.pip-toolbar-row[\s\S]*?flex-wrap:\s*nowrap/);
    expect(panelCss).toMatch(/@media \(max-width:\s*320px\)[\s\S]*\.pip-toolbar-row/);
    expect(panelCss).toContain('pipAiLabReveal');
  });

  it('toggles the AI Lab panel from AI and collapses with the close control', () => {
    const ui = webview();
    const panel = ui.get('pipAiLab');
    panel.setAttribute('hidden', '');
    ui.get('aiBtn').listeners.click?.[0]?.({});
    expect(panel.hasAttribute('hidden')).toBe(false);
    expect(ui.get('aiBtn').getAttribute('aria-expanded')).toBe('true');
    ui.get('pipAiLabCloseBtn').listeners.click?.[0]?.({});
    expect(panel.hasAttribute('hidden')).toBe(true);
    expect(ui.get('aiBtn').getAttribute('aria-expanded')).toBe('false');
  });

  it('renders collapsible knowledge-check details in AI Lab replies', () => {
    const ui = webview();
    ui.message({
      type: 'aiLabReply',
      headline: 'Temperature redistributes probability.',
      parts: [
        {
          title: '🎯 Quick Knowledge Check',
          body: '**Question:** At T=0?\nA) Greedy\nB) Uniform\n<details><summary>Reveal Answer</summary>**Answer:** A — always the top token.</details>',
        },
      ],
    });
    const out = ui.get('pipAiLabOutput');
    const details = descendants(out).find((node) => node.tagName === 'details');
    expect(details).toBeTruthy();
    expect(details?.className).toBe('pip-ai-lab-kc');
    const summary = descendants(details!).find((node) => node.tagName === 'summary');
    expect(summary?.textContent).toContain('Reveal Answer');
    expect(details!.textContent).toContain('always the top token');
  });

  it('describes generated controls without replacing a more specific tooltip', () => {
    const ui = webview();
    const summary = runInContext("describeControl(Object.assign(document.createElement('summary'), {textContent: 'Evidence and challenge'}))", ui.context) as Element;
    expect(summary.title || '').toBe('');
    const button = runInContext("describeControl(Object.assign(document.createElement('button'), {textContent: 'Ask', title: 'Ask about this branch'}))", ui.context) as Element;
    expect(button.title).toBe('Ask about this branch');
  });

  it('hides empty memory and reviewer chatter while retaining an actual correction', () => {
    const ui = webview();
    ui.message({ type: 'explanation', explanation: { ...explanation, repaired: true }, learning: { reference: 'Nothing stored for this selection yet — an explanation saves it.' } });
    expect(ui.get('hint').classList.contains('hidden')).toBe(true);
    expect(ui.get('result').textContent).not.toContain('Evaluator trimmed');
    ui.message({ type: 'explanationReview', status: 'uncertain', text: 'No matching quote; unchanged.' });
    expect(ui.get('result').textContent).not.toContain('matching quote');
    ui.message({ type: 'explanationReview', status: 'revised', text: 'Corrected the claim using the source.', explanation: { ...explanation, bottomLine: 'Corrected statement.' } });
    expect(ui.get('result').textContent).toContain('Corrected statement');
    expect(ui.get('result').textContent).toContain('Corrected the claim');
  });

  it('draws participant lifelines for sequence and follows explicit data-flow branches', () => {
    const ui = webview();
    const nodes = [{ id: 'requests', kind: 'method', label: 'requests', detail: 'source' }, { id: 'paths', kind: 'call', label: 'paths', detail: 'paths' }, { id: 'params', kind: 'call', label: 'params', detail: 'params' }];
    const dataFlow = { nodes, edges: [{ from: 'requests', to: 'paths', label: 'map pathnames' }, { from: 'requests', to: 'params', label: 'read search params' }] };
    ui.message({ type: 'diagrams', diagrams: { dataFlow, sequence: { nodes, edges: [], sequence: { participants: [{ id: 'test', label: 'Test' }, { id: 'api', label: 'API' }], messages: [{ from: 'test', to: 'api', label: 'load()', sourceLine: 12 }, { from: 'test', to: 'api', label: 'load()', sourceLine: 14 }] } }, availableTypes: ['dataFlow', 'sequence'] } });
    expect(ui.get('diagram').querySelector('.dataFlowDiagram')).toBeDefined();
    expect(ui.get('diagram').textContent).toContain('map pathnames');
    expect(ui.get('diagram').textContent).toContain('read search params');
    const arrows = descendants(ui.get('diagram')).filter((node) => node.classList.contains('edgeHead'));
    expect(arrows).toHaveLength(2);
    ui.buttons[1]!.listeners.click![0]!({});
    expect(ui.get('diagram').querySelector('.sequenceDiagram')).toBeDefined();
    const lifelines = descendants(ui.get('diagram')).filter((node) => node.classList.contains('sequenceLifeline'));
    expect(lifelines).toHaveLength(2);
    expect(ui.get('diagram').textContent).toContain('L12');
    expect(ui.get('diagram').textContent).toContain('L14');
  });

  it('shows a finite completion pulse at zero and remembers whether sound is muted', () => {
    const ui = webview({ timerSoundEnabled: false });
    expect(ui.get('pipMuteBtn').attrs['aria-pressed']).toBe('true');
    ui.get('pipTimeboxInput').value = '1';
    ui.get('pipStartBtn').listeners.click![0]!({});
    runInContext('remaining = 1', ui.context);
    ui.intervals[0]!.fn();
    expect(ui.get('timerOut').textContent).toBe('Timebox complete');
    expect(ui.get('timerOut').classList.contains('timeboxComplete')).toBe(true);
    const pulse = ui.timeouts.find((item) => item.ms === 2600)!;
    pulse.fn();
    expect(ui.get('timerOut').classList.contains('timeboxComplete')).toBe(false);
    ui.get('pipMuteBtn').listeners.click![0]!({});
    expect(ui.state().timerSoundEnabled).toBe(true);
    expect(ui.get('pipMuteBtn').title).toContain('Mute');
  });
});


describe('timebox audio cue', () => {
  it('stops one short chime and remains silent when muted', () => {
    const ui = webview();
    runInContext(`
      globalThis.chimes = [];
      timerAudio = {
        currentTime: 10, destination: {},
        createOscillator: () => ({ frequency: { setValueAtTime() {} }, connect() {}, start() { chimes.push('start'); }, stop(at) { chimes.push(at); } }),
        createGain: () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} })
      };
      finishTimebox();
    `, ui.context);
    expect(runInContext('chimes.join(",")', ui.context)).toBe('start,10.38');
    ui.get('pipMuteBtn').listeners.click![0]!({});
    runInContext('finishTimebox()', ui.context);
    expect(runInContext('chimes.length', ui.context)).toBe(2);
  });
});


describe('whole-test visualisation guidance', () => {
  it('keeps wide sequence diagrams in a keyboard-scrollable region and preserves long participant names', () => {
    const ui = webview();
    const label = 'allScope_appliesSearchFilterOrderedByName_withoutClippingTheHeader';
    const participants = [{ id: 'test', label }, ...Array.from({ length: 7 }, (_, index) => ({ id: `repo-${index}`, label: `repository${index}` }))];
    const graph = { nodes: [{ id: 'method', kind: 'method', label, detail: 'selected method' }], edges: [], sequence: { participants, messages: [{ from: 'test', to: 'repo-6', label: 'repository6.findFiltered()', sourceLine: 95 }] } };
    ui.message({ type: 'diagrams', diagrams: { sequence: graph, availableTypes: ['sequence'] } });
    const viewport = ui.get('diagram').querySelector('.diagramCanvas')!;
    expect(viewport).toBeDefined();
    expect(viewport.attrs.tabindex).toBe('0');
    expect(viewport.attrs['aria-label']).toContain('scroll horizontally');
    const svg = viewport.querySelector('.sequenceDiagram')!;
    expect(Number(svg.attrs['data-natural-width'])).toBeGreaterThan(1000);
    expect((svg.style as { width: string }).width).toMatch(/px$/);
    const headerText = descendants(svg).filter((node) => node.classList.contains('sequenceLabel')).map((node) => node.textContent).join('');
    expect(headerText).toContain(label);
    expect(ui.get('diagram').textContent).toContain('separate tests do not execute in file order');
    ui.get('zoomOutBtn').listeners.click![0]!({});
    expect((svg.style as { width: string }).width).toBe(`${Number(svg.attrs['data-natural-width']) * 0.8}px`);
  });

  it('offers a collapsed request-counting guide with concrete browser and applicable test steps', () => {
    const ui = webview();
    ui.message({ type: 'diagrams', diagrams: { growth: { nodes: [], edges: [], series: [{ name: 'n', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }] }, availableTypes: ['growth'] } });
    const guide = ui.get('diagram').querySelector('.requestCountingGuide')!;
    expect(guide).toBeDefined();
    expect(guide.open).toBe(false);
    expect(guide.querySelector('summary')!.textContent).toBe('How to count requests');
    expect(guide.textContent).toContain('Developer Tools → Network');
    expect(guide.textContent).toContain('Fetch/XHR');
    expect(guide.textContent).toContain('mockClear()');
    expect(guide.textContent).toContain('mock.calls.length');
    expect(guide.textContent).toContain('only to a frontend test that uses Vitest');
    expect(guide.textContent).toContain('Java/JUnit');
    expect(guide.textContent).toContain('not a real network measurement');
    expect(descendants(guide).some((node) => node.tagName === 'script')).toBe(false);
  });
});


describe('JUnit testing graph relationships', () => {
  it('draws only setup-to-test and test-to-assertion edges without chaining independent tests', () => {
    const ui = webview();
    const nodes = [
      { id: 'junit:setup:1', kind: 'param', label: '@BeforeEach setUp()', detail: 'runs before each test' },
      { id: 'junit:test:2', kind: 'method', label: '@Test allScope_appliesSearchFilterOrderedByName()', detail: 'independent test' },
      { id: 'junit:test:3', kind: 'method', label: '@Test noneScope_returnsEmpty()', detail: 'independent test' },
      { id: 'junit:assert:4', kind: 'assert', label: 'assertThat(result).isEmpty()', detail: 'assertion in noneScope' },
    ];
    const edges = [
      { from: 'junit:setup:1', to: 'junit:test:2', label: 'before each' },
      { from: 'junit:setup:1', to: 'junit:test:3', label: 'before each' },
      { from: 'junit:test:3', to: 'junit:assert:4', label: 'asserts' },
    ];
    ui.message({ type: 'diagrams', diagrams: { testing: { nodes, edges, caption: 'Independent JUnit tests; not execution or coverage evidence.' }, availableTypes: ['testing'] } });
    const svg = ui.get('diagram').querySelector('.testingDiagram')!;
    expect(svg).toBeDefined();
    const relations = descendants(svg).filter((node) => node.classList.contains('graphRelation'));
    expect(relations.map((node) => ({ from: node.attrs['data-from'], to: node.attrs['data-to'] }))).toEqual(edges.map(({ from, to }) => ({ from, to })));
    expect(relations).toHaveLength(3);
    expect(ui.get('diagram').textContent).toContain('before each');
    expect(ui.get('diagram').textContent).toContain('asserts');
    expect(ui.get('diagram').textContent).toContain('not execution or coverage evidence');
  });
});


it('keeps diagram families in sync with available views and the selected option', () => {
  const ui = webview();
  const graph = { nodes: [{ id: 'a', kind: 'method', label: 'one', detail: 'one' }, { id: 'b', kind: 'call', label: 'two', detail: 'two' }], edges: [] };
  ui.message({ type: 'diagrams', diagrams: { dataFlow: graph, sequence: graph, availableTypes: ['dataFlow', 'sequence'] } });
  expect(ui.family.disabled).toBe(false);
  expect(ui.family.options.find(option => option.value === 'dependencies')?.disabled).toBe(true);
  expect(ui.family.value).toBe('dataFlow');
  ui.family.value = 'sequence';
  ui.family.listeners.change![0]!({});
  expect(ui.family.value).toBe('sequence');
  ui.message({ type: 'diagrams', diagrams: { dataFlow: graph, availableTypes: ['dataFlow'] } });
  expect(ui.family.value).toBe('dataFlow');
  expect(ui.family.options.find(option => option.value === 'sequence')?.disabled).toBe(true);
});
