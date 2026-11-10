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
  querySelector(selector: string) { return nodes(this).find((node) => selector.startsWith('.') ? node.className.includes(selector.slice(1)) : false); }
  focus() {}
  contains(node: Node): boolean { return this === node || this.children.some((child) => child.contains(node)); }
}

function nodes(root: Node): Node[] { return [root, ...root.children.flatMap(nodes)]; }
function webview(saved: Record<string, any> = {}) {
  const ids = new Map<string, Node>();
  const posted: Record<string, unknown>[] = [];
  const handlers: ((event: unknown) => void)[] = [];
  const get = (id: string) => {
    if (!ids.has(id)) ids.set(id, new Node());
    return ids.get(id)!;
  };
  const context = createContext({
    acquireVsCodeApi: () => ({ postMessage: (msg: Record<string, unknown>) => posted.push(msg), getState: () => saved, setState: (state: Record<string, unknown>) => Object.assign(saved, state) }),
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

describe('Solve webview', () => {
  it('pins context then sends the question with the chat arrow', () => {
    expect(LEARN_BODY).toContain('Question &amp; Answer');
    expect(LEARN_BODY).toContain('class="chatQuestionLabel"');
    expect(LEARN_BODY).toMatch(/id="chatInput"[\s\S]*id="cursorPasteBlock"/);
    expect(LEARN_BODY).not.toContain('cursorPasteLoadBtn');
    const ui = webview();
    ui.get('cursorPasteExcerpt').value = 'Cursor said: the filter uses LIKE with ESCAPE.';
    ui.get('chatInput').value = 'Why ESCAPE?';
    ui.click('chatSendBtn');
    expect(ui.posted.at(-1)).toEqual({
      type: 'pasteFromCursor',
      excerpt: 'Cursor said: the filter uses LIKE with ESCAPE.',
      question: 'Why ESCAPE?',
    });
    ui.message({ type: 'context', context: { file: 'Solve chat', selection: 'Cursor said: the filter uses LIKE with ESCAPE.', line: 1 } });
    ui.message({ type: 'pasteResult', ok: true, label: 'Solve chat', chars: 42 });
    expect(ui.posted.some((msg) => msg.type === 'chat' && msg.text === 'Why ESCAPE?')).toBe(true);
  });

  it('shows collapsed evidence, verified file links, and solver terms independently of Learn', () => {
    const ui = webview();
    runInContext("keywordSet = new Set(['method'])", ui.context);
    ui.message({
      type: 'solverReply',
      reply: {
        restate: 'The method in `PartnerService.java` cannot be found. See `Unknown.java`.',
        cause: 'Overload resolution may fail.', confidence: 'possible', check: 'Inspect the method.',
        reason: 'The compiler cannot resolve the call.', evidence: ['error: cannot find symbol'],
        unknown: 'The declaration was not supplied.',
      },
      keywords: ['overload resolution'], sources: ['Pasted error'], files: [{ label: 'PartnerService.java', id: 'file-1', line: 105 }],
    });
    const all = nodes(ui.get('solverResult'));
    const details = all.find((node) => node.tagName === 'details')!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('Why this suggestion?');
    expect(details.textContent).toContain('Pasted error');
    expect(details.textContent).toContain('cannot find symbol');
    expect(details.textContent).toContain('The declaration was not supplied.');
    const links = all.filter((node) => node.tagName === 'button' && node.className !== 'solverHeader');
    const header = all.find((node) => node.className === 'solverHeader' && node.textContent === 'Clue:')!;
    header.onclick?.({ clientX: 10, clientY: 10 });
    expect(ui.posted.at(-1)).toMatchObject({ type: 'popupExplain', scope: 'solver' });
    expect(links.map((node) => node.textContent)).toEqual(['PartnerService.java', 'Overload resolution', 'PartnerService.java']);
    links[0]!.onclick?.({});
    expect(ui.posted.at(-1)).toEqual({ type: 'openSolverFile', id: 'file-1' });
    links[1]!.onclick?.({ clientX: 10, clientY: 10 });
    expect(ui.posted.at(-1)).toEqual({ type: 'popupExplain', word: 'Overload resolution', scope: 'solver' });
    expect(ui.get('wordPopupTitle').textContent).toBe('Overload resolution');
  });

  it('keeps the overview pinned while two popups form a breadcrumb trail', () => {
    const ui = webview();
    ui.get('result').textContent = 'overview stays';
    runInContext("openPopup('LIKE', 10, 10)", ui.context);
    ui.message({ type: 'popupAnswer', word: 'LIKE', text: 'LIKE matches text against a pattern.' });
    runInContext("openPopup('ESCAPE', 20, 20)", ui.context);
    ui.message({ type: 'popupAnswer', word: 'ESCAPE', text: 'ESCAPE makes the wildcard literal.' });
    // The overview underneath is never replaced by popup exploration.
    expect(ui.get('result').textContent).toBe('overview stays');
    const crumbs = ui.get('wordPopupCrumbs');
    expect(crumbs.textContent).toContain('Overview');
    expect(crumbs.textContent).toContain('LIKE');
    expect(crumbs.textContent).toContain('ESCAPE');
    // Going back to LIKE restores its thread with no new model call.
    const explains = ui.posted.filter((msg) => msg.type === 'popupExplain' && msg.word === 'LIKE').length;
    const likeLink = nodes(crumbs).find((node) => node.tagName === 'button' && node.textContent === 'LIKE')!;
    likeLink.onclick?.({});
    expect(ui.get('wordPopupTitle').textContent).toBe('LIKE');
    expect(ui.get('wordPopupBody').textContent).toContain('LIKE matches text');
    expect(ui.posted.filter((msg) => msg.type === 'popupExplain' && msg.word === 'LIKE')).toHaveLength(explains);
    // Back to overview just closes the popup; the overview is still there.
    ui.click('wordPopupBack');
    expect(ui.get('wordPopup').className).toContain('hidden');
    expect(ui.get('result').textContent).toBe('overview stays');
  });

  it('never treats an unresolved filename as a glossary popup, even in backticks', () => {
    const ui = webview();
    const output = runInContext("rich('`Example.java` and `methodSignature`', new Set(['example.java']))", ui.context) as Node;
    expect(nodes(output).filter((node) => node.tagName === 'button')).toHaveLength(0);
    expect(output.textContent).toBe('Example.java and methodSignature');
  });

  it('links a unique verified basename and releases Solve controls after an error', () => {
    const ui = webview();
    ui.get('solverProblem').value = 'Cannot compile';
    ui.click('solveBtn');
    expect(ui.get('solveBtn').disabled).toBe(true);
    ui.message({ type: 'solverError', text: 'Try again with a shorter error.' });
    expect(ui.get('solveBtn').disabled).toBe(false);
    expect(ui.get('solverResult').textContent).toBe('Try again with a shorter error.');
    ui.message({
      type: 'solverReply',
      reply: { restate: 'Read `PartnerService.java`.', confidence: 'possible', evidence: [] },
      files: [{ label: '/workspace/src/PartnerService.java', id: 'file-1' }],
    });
    const link = nodes(ui.get('solverResult')).find((node) => node.tagName === 'button' && node.textContent === 'PartnerService.java');
    expect(link).toBeDefined();
    link!.onclick?.({});
    expect(ui.posted.at(-1)).toEqual({ type: 'openSolverFile', id: 'file-1' });
  });

  it('submits duck statements once, includes visible problem context, and displays the matching reply', () => {
    const ui = webview();
    ui.get('duckInput').value = 'I think this fails before the test runs.';
    ui.get('solverProblem').value = 'Compilation fails';
    ui.get('solverError').value = 'error: cannot find symbol';
    ui.click('duckSubmitBtn');
    const request = ui.posted.at(-1)!;
    expect(request).toMatchObject({ type: 'duck', statement: 'I think this fails before the test runs.', problem: 'Compilation fails', errorText: 'error: cannot find symbol' });
    expect(ui.get('duckSubmitBtn').disabled).toBe(true);
    expect(ui.get('duckLog').textContent).toContain('Checking your understanding locally');
    ui.get('duckInput').value = 'Another thought';
    ui.click('duckSubmitBtn');
    expect(ui.posted.at(-1)).toBe(request);
    ui.message({ type: 'duckReply', id: 'old-request', text: 'Old reply' });
    expect(ui.get('duckLog').textContent).not.toContain('Old reply');
    ui.message({ type: 'duckReply', id: request.id, text: 'Holds: compilation must succeed before the test runs.', source: 'Based on pasted error' });
    expect(ui.get('duckLog').textContent).toContain('PIP: Holds: compilation must succeed');
    expect(ui.get('duckLog').textContent).not.toContain('Checking your understanding locally');
    expect(ui.get('duckSubmitBtn').disabled).toBe(false);
    expect(ui.get('duckInput').disabled).toBe(false);
    expect(ui.get('duckLog').attrs['aria-busy']).toBe('false');
  });

  it('captures a selection in Solve, restores drafts, and checks a guided answer', () => {
    const saved: Record<string, any> = {};
    const ui = webview(saved);
    runInContext("applyMode('solve')", ui.context);
    ui.click('explainBtn');
    // Select feeds the Solve chat and also refreshes Learn in the background.
    expect(ui.posted.slice(-2)).toEqual([{ type: 'captureSolverSelection' }, { type: 'explainSelection' }]);
    const selection = { file: 'src/Test.java', line: 7, language: 'java', selection: 'call()', surrounding: '' };
    ui.message({ type: 'solverSelection', context: selection });
    ui.get('solverProblem').value = 'Why does this fail?';
    ui.get('solverProblem').listeners.input![0]!({});
    ui.get('solverError').value = 'error here';
    ui.get('solverError').listeners.input![0]!({});
    const restored = webview(saved);
    expect(restored.get('solverProblem').value).toBe('Why does this fail?');
    expect(restored.get('solverError').value).toBe('error here');
    expect(restored.get('solverSelectionInfo').textContent).toContain('src/Test.java:7');
    restored.click('solveDirectBtn');
    expect(restored.posted.at(-1)).toEqual({ type: 'solve', mode: 'direct', problem: 'Why does this fail?', errorText: 'error here', selection });
    restored.message({ type: 'solverReply', mode: 'together', reply: { restate: 'Check it', question: 'What did you find?', evidence: [], confidence: 'possible', strategy: 'Set a breakpoint.' } });
    expect(restored.get('solverResult').textContent).toContain('Set a breakpoint');
    restored.get('solverAnswer').value = 'It is null';
    restored.click('solverCheckBtn');
    const request = restored.posted.at(-1)!;
    expect(request).toMatchObject({ type: 'solverCheck', answer: 'It is null' });
    restored.message({ type: 'solverCheckReply', id: request.id, text: 'The null value is plausible; inspect the caller.' });
    expect(restored.get('solverCheckResult').textContent).toContain('inspect the caller');
  });

  it('offers compact footer buttons and toggles voice settings without a persistent card', () => {
    const ui = webview();
    ui.get('moreDrawer').className = 'hidden';
    expect(LEARN_BODY).toContain('id="moreDrawer" class="cnvs-card cnvs-card-pad hidden"');
    expect(LEARN_BODY).not.toContain('class="shortcuts"');
    expect(LEARN_BODY).toContain('data-mode="create">Ideate</button>');
    ui.click('voiceModeBtn');
    expect(ui.get('moreDrawer').classList.contains('hidden')).toBe(false);
    expect(ui.get('voiceModeBtn').attrs['aria-expanded']).toBe('true');
    ui.click('collapseAllBtn');
    expect(ui.get('moreDrawer').classList.contains('hidden')).toBe(true);
    ui.click('helpBtn');
    expect(ui.posted.at(-1)).toEqual({ type: 'help' });
  });
});


describe('Solver modes and useful evidence', () => {
  it('does not add a speculative confidence badge to an answer directly observed in the supplied test', () => {
    const ui = webview();
    ui.message({ type: 'solverReply', mode: 'direct', reply: { cause: 'The test saves a link and asserts the partner ID.', observed: true, confidence: 'possible', evidence: [] } });
    expect(nodes(ui.get('solverResult')).some(node => node.className === 'solverConfidence')).toBe(false);
  });

  it('visibly selects the chosen response mode and restores its pressed state', () => {
    const saved: Record<string, any> = {};
    const ui = webview(saved);
    expect(ui.get('solveBtn').attrs['aria-pressed']).toBe('true');
    expect(ui.get('solveDirectBtn').attrs['aria-pressed']).toBe('false');
    ui.get('solverProblem').value = 'Why does this fail?';
    ui.click('solveDirectBtn');
    expect(ui.get('solveDirectBtn').classList.contains('solverModeSelected')).toBe(true);
    expect(ui.get('solveDirectBtn').attrs['aria-pressed']).toBe('true');
    expect(ui.get('solveBtn').attrs['aria-pressed']).toBe('false');
    expect(saved.solver.mode).toBe('direct');
    const restored = webview(saved);
    expect(restored.get('solveDirectBtn').attrs['aria-pressed']).toBe('true');
    restored.click('solveBtn');
    expect(restored.get('solveBtn').classList.contains('solverModeSelected')).toBe(true);
    expect(restored.posted.at(-1)).toMatchObject({ mode: 'together' });
  });

  it('explains confidence without a fake probability and suppresses repeated placeholder details', () => {
    const ui = webview();
    ui.message({ type: 'solverReply', mode: 'direct', reply: {
      cause: 'The receiver might use a different API version.', confidence: 'long shot', evidence: [],
      reason: 'The model did not supply a matching quote for this hypothesis; its cause is unverified.',
      unknown: 'The cause has not been verified against the implementation or a running check.',
    } });
    const result = ui.get('solverResult');
    const badge = nodes(result).find((node) => node.classList.contains('solverConfidence'))!;
    expect(badge.textContent).toBe('Tentative');
    expect(badge.attrs['aria-label']).toContain('Weakly supported');
    expect(badge.attrs.tabindex).toBe('0');
    expect(result.textContent).toContain('Answer:');
    expect(result.textContent).not.toContain('undefined');
    expect(result.textContent).not.toContain('matching quote');
    expect(result.textContent).not.toContain('Still unknown');
    expect(nodes(result).some((node) => node.tagName === 'details')).toBe(false);
    ui.message({ type: 'solverReply', mode: 'together', reply: { cause: 'An overload may differ.', confidence: 'possible', evidence: [],
      unknown: 'The PartnerService declaration and build classpath have not been inspected.' } });
    expect(ui.get('solverResult').textContent).toContain('PartnerService declaration and build classpath');
    expect(ui.get('solverResult').textContent).toContain('Hypothesis:');
  });
});

describe('Structured summary questions', () => {
  const questions = [
    { conceptId: 'one', term: 'SQL LIKE', question: 'What does an escaped percent sign match?', source: 'Search.java:10' },
    { conceptId: 'two', term: 'Nullability', question: 'Which input reaches the null return?', source: 'Search.java:12' },
  ];
  it('renders separate source-backed questions, ignores legacy prose, and labels prior dates accurately', () => {
    const ui = webview();
    ui.message({ type: 'today', review: { date: '2026-10-01', text: 'Legacy model prose that must never be shown.', questions } });
    const card = ui.get('reviewCard');
    expect(card.textContent).toContain('Previous summary (2026-10-01)');
    expect(card.textContent).not.toContain('yesterday');
    expect(card.textContent).not.toContain('Legacy model prose');
    expect(nodes(card).filter((node) => node.classList.contains('reviewQuestion'))).toHaveLength(2);
    expect(card.textContent).toContain('Search.java:10');
    ui.message({ type: 'today', review: { date: '2026-10-01', text: 'Raw legacy summary only.' } });
    expect(card.textContent).not.toContain('Raw legacy');
  });

  it('replaces the current summary instead of appending duplicates and shows explicit errors', () => {
    const ui = webview();
    ui.message({ type: 'reviewCard', questions });
    ui.message({ type: 'reviewCard', questions: questions.slice(0, 1) });
    expect(nodes(ui.get('reviewCard')).filter((node) => node.classList.contains('reviewQuestion'))).toHaveLength(1);
    ui.message({ type: 'reviewCard', questions: [], text: 'Keep an idea first.' });
    expect(ui.get('reviewCard').textContent).toBe('Keep an idea first.');
  });
});
