import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionContext } from 'vscode';
import type { ChatMessage } from '../shared/types';

const harness = vi.hoisted(() => {
  class Range {
    start: { line: number; character: number };
    end: { line: number; character: number };
    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
      this.start = { line: startLine, character: startCharacter };
      this.end = { line: endLine, character: endCharacter };
    }
  }
  const uri = (path: string) => ({ scheme: 'file', fsPath: path, path, toString: () => `file://${path}` });
  return {
    Range,
    uri,
    handler: undefined as undefined | ((message: Record<string, unknown>) => void),
    editorChanged: undefined as undefined | ((editor: unknown) => void),
    posts: [] as Record<string, unknown>[],
    window: {
      activeTextEditor: undefined as unknown,
      visibleTextEditors: [] as unknown[],
      onDidChangeActiveTextEditor: vi.fn(),
      showInformationMessage: vi.fn(),
      showTextDocument: vi.fn(),
      registerWebviewViewProvider: vi.fn(),
      showQuickPick: vi.fn(),
      showOpenDialog: vi.fn(),
    },
    workspace: {
      getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
      asRelativePath: (value: { fsPath: string }) => value.fsPath.replace('/workspace/', ''),
      findFiles: vi.fn(),
      getWorkspaceFolder: vi.fn(),
      fs: { stat: vi.fn(), readFile: vi.fn() },
      openTextDocument: vi.fn(),
    },
    chat: vi.fn(),
    clipboard: vi.fn(),
    openExternal: vi.fn(),
    stream: vi.fn(),
    disposable: { dispose: vi.fn() },
  };
});

vi.mock('vscode', () => ({
  window: harness.window,
  workspace: harness.workspace,
  Uri: { file: harness.uri, parse: harness.uri },
  env: { appName: 'Cursor', clipboard: { writeText: harness.clipboard }, openExternal: harness.openExternal },
  Range: harness.Range,
  WorkspaceEdit: class { edits: unknown[][] = []; replace(...args: unknown[]) { this.edits.push(args); } },
  FileType: { File: 1 },
  ViewColumn: { One: 1, Beside: 2 },
  commands: { registerCommand: vi.fn(() => harness.disposable), executeCommand: vi.fn() },
}));

vi.mock('../ui/sidebar', () => ({
  SidebarProvider: class {
    onMessage(handler: typeof harness.handler) { harness.handler = handler; }
    post(message: Record<string, unknown>) { harness.posts.push(message); }
    refresh() {}
  },
}));
vi.mock('../ui/panel', () => ({ LearnPanel: { show: vi.fn() } }));
vi.mock('node:child_process', () => ({
  execFile: vi.fn((...args: unknown[]) => {
    const callback = args.at(-1);
    if (typeof callback === 'function') callback(null, '');
    return { kill: vi.fn() };
  }),
}));
vi.mock('../platform/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/provider')>();
  return {
    ...actual,
    OllamaProvider: class {
      chat = harness.chat;
      chatStream = harness.stream;
    },
  };
});

import { activate } from '../extension';

const solverOutput = [
  'RESTATE: The selected call cannot be resolved.',
  'CAUSE: The compile-time type may lack this method (confidence: possible)',
  'CHECK: Inspect the receiver type.',
  'QUESTION:',
  'WHY: The compiler cannot resolve the call.',
  'EVIDENCE: cannot find symbol',
  'UNKNOWN: The declaration has not been inspected.',
].join('\n');

const diagnostic = [
  '/workspace/src/PartnerServiceFilterIntTest.java:105: error: cannot find symbol',
  'symbol: method findFilteredInScope(Partners,PartnerFilterCriteria)',
  'location: variable partnerService of type PartnerService',
].join('\n');

function editor(path: string, text: string) {
  const lines = text.split('\n');
  return {
    document: {
      uri: harness.uri(path), languageId: 'java', lineCount: lines.length, isClosed: false,
      getText: () => text,
      lineAt: (line: number) => ({ text: lines[line] ?? '' }),
    },
    selection: {
      isEmpty: false, start: { line: 0, character: 0 }, end: { line: lines.length - 1, character: 0 },
      active: { line: 0, character: 0 },
    },
  };
}

function setEditor(value: unknown): void {
  harness.window.activeTextEditor = value;
  harness.window.visibleTextEditors = value ? [value] : [];
  harness.editorChanged?.(value);
}

async function send(message: Record<string, unknown>, replyType: string): Promise<Record<string, unknown>> {
  const first = harness.posts.length;
  harness.handler?.(message);
  await vi.waitFor(() => expect(harness.posts.slice(first).some((post) => post.type === replyType)).toBe(true));
  return harness.posts.slice(first).find((post) => post.type === replyType)!;
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.posts.length = 0;
  harness.window.activeTextEditor = undefined;
  harness.window.visibleTextEditors = [];
  harness.window.onDidChangeActiveTextEditor.mockImplementation((listener) => {
    harness.editorChanged = listener;
    return harness.disposable;
  });
  harness.workspace.findFiles.mockResolvedValue([]);
  harness.workspace.getWorkspaceFolder.mockImplementation((uri: { fsPath: string }) =>
    uri.fsPath.startsWith('/workspace/') ? { uri: harness.uri('/workspace') } : undefined,
  );
  harness.workspace.fs.stat.mockResolvedValue({ type: 1 });
  harness.workspace.openTextDocument.mockResolvedValue({ lineCount: 200 });
  harness.window.showTextDocument.mockResolvedValue(undefined);
  harness.chat.mockImplementation(async (messages: ChatMessage[], model: string) => ({
    text: messages.some((message) => message.content.includes('[INTENT:duck]'))
      ? 'Partly holds: the error concerns the declared receiver type, not runtime behaviour.\nWhich methods does that type expose?'
      : solverOutput,
    model, fromMock: false,
  }));
  harness.stream.mockResolvedValue({ text: 'BOTTOM_LINE: Old selection.\n### Old\nThis is old code.', model: 'local', fromMock: false });
  const state = new Map<string, unknown>();
  activate({
    extensionUri: harness.uri('/extension'), subscriptions: [],
    globalState: {
      get: (key: string, fallback: unknown) => state.get(key) ?? fallback,
      update: async (key: string, value: unknown) => { state.set(key, value); },
    },
  } as unknown as ExtensionContext);
});

describe('Solve extension message flow', () => {
  it('checks a duck explanation against a pasted problem/error without requiring Explain', async () => {
    const reply = await send({ type: 'duck', id: 'duck-1', statement: 'This means a runtime failure.', problem: 'My test does not compile.', errorText: diagnostic }, 'duckReply');
    expect(reply).toMatchObject({ id: 'duck-1', fromMock: false });
    expect(reply.text).toContain('Partly holds');
    expect(reply.source).toContain('Problem text');
    expect(reply.source).toContain('Pasted error/log');
    const prompt = harness.chat.mock.calls[0]?.[0].map((message: ChatMessage) => message.content).join('\n');
    expect(prompt).toContain('This means a runtime failure.');
    expect(prompt).toContain(diagnostic);
  });

  it('returns actionable feedback when a duck submission has no code or problem context', async () => {
    const reply = await send({ type: 'duck', id: 'duck-2', statement: 'This filters the partners.' }, 'duckReply');
    expect(reply.id).toBe('duck-2');
    expect(reply.text).toMatch(/select code.*paste the problem\/error/i);
    expect(harness.chat).not.toHaveBeenCalled();
  });

  it('reports an unavailable model without inventing a confirmation or correction', async () => {
    harness.chat.mockRejectedValue(new Error('ECONNREFUSED'));
    const reply = await send({ type: 'duck', id: 'duck-offline', statement: 'This is a type mismatch.', problem: diagnostic }, 'duckReply');
    expect(reply).toMatchObject({ id: 'duck-offline', fromMock: true });
    expect(reply.text).toMatch(/unavailable.*could not check/i);
    expect(reply.text).not.toMatch(/holds|state changes/i);
  });

  it('uses the current editor rather than code cached by an earlier Explain', async () => {
    setEditor(editor('/workspace/src/Old.java', 'class Old { void staleSelection() {} }'));
    await send({ type: 'explainSelection' }, 'explanation');
    setEditor(editor('/workspace/src/Current.java', 'class Current { void currentSelection() {} }'));
    const reply = await send({ type: 'solve', problem: diagnostic, errorText: '' }, 'solverReply');
    const prompt = harness.chat.mock.calls.at(-1)?.[0].map((message: ChatMessage) => message.content).join('\n');
    expect(prompt).toContain('currentSelection');
    expect(prompt).not.toContain('staleSelection');
    expect((reply.sources as string[]).join('\n')).toContain('Current.java');
    expect((reply.sources as string[]).join('\n')).not.toContain('Old.java');
  });

  it('does not reintroduce a cached Explain selection after its editor closes', async () => {
    setEditor(editor('/workspace/src/Old.java', 'class Old { void staleSelection() {} }'));
    await send({ type: 'explainSelection' }, 'explanation');
    setEditor(undefined);
    const reply = await send({ type: 'solve', problem: diagnostic }, 'solverReply');
    const prompt = harness.chat.mock.calls.at(-1)?.[0].map((message: ChatMessage) => message.content).join('\n');
    expect(prompt).not.toContain('staleSelection');
    expect((reply.sources as string[]).join('\n')).not.toContain('Editor');
  });

  it('opens a verified file token at the diagnostic line', async () => {
    const reply = await send({ type: 'solve', problem: diagnostic }, 'solverReply');
    const files = reply.files as { label: string; id: string; line?: number }[];
    const target = files.find((file) => file.line === 105)!;
    expect(target.label).toBe('/workspace/src/PartnerServiceFilterIntTest.java');
    harness.handler?.({ type: 'openSolverFile', id: target.id });
    await vi.waitFor(() => expect(harness.window.showTextDocument).toHaveBeenCalled());
    expect(harness.workspace.openTextDocument).toHaveBeenCalledWith(expect.objectContaining({ fsPath: target.label }));
    expect(harness.window.showTextDocument.mock.calls[0]?.[1]).toMatchObject({ preview: true, viewColumn: 1, selection: { start: { line: 104 }, end: { line: 104 } } });
  });

  it('clamps a diagnostic line when the document has since become shorter', async () => {
    harness.workspace.openTextDocument.mockResolvedValue({ lineCount: 20 });
    const reply = await send({ type: 'solve', problem: diagnostic }, 'solverReply');
    const target = (reply.files as { id: string; line?: number }[]).find((file) => file.line === 105)!;
    harness.handler?.({ type: 'openSolverFile', id: target.id });
    await vi.waitFor(() => expect(harness.window.showTextDocument).toHaveBeenCalled());
    expect(harness.window.showTextDocument.mock.calls[0]?.[1]).toMatchObject({ selection: { start: { line: 19 }, end: { line: 19 } } });
  });

  it('expires old file tokens after another solver response replaces the result', async () => {
    const first = await send({ type: 'solve', problem: diagnostic }, 'solverReply');
    const token = (first.files as { id: string }[])[0]!.id;
    await send({ type: 'solve', problem: diagnostic }, 'solverReply');
    harness.handler?.({ type: 'openSolverFile', id: token });
    await vi.waitFor(() => expect(harness.window.showInformationMessage).toHaveBeenCalled());
    expect(harness.workspace.openTextDocument).not.toHaveBeenCalled();
  });

  it('does not treat a path supplied by the webview as an authorized file token', async () => {
    harness.handler?.({ type: 'openSolverFile', id: '/outside/private.java', path: '/outside/private.java' });
    await vi.waitFor(() => expect(harness.window.showInformationMessage).toHaveBeenCalled());
    expect(harness.workspace.openTextDocument).not.toHaveBeenCalled();
    expect(harness.window.showTextDocument).not.toHaveBeenCalled();
  });
});


describe('Ideation investigation and review', () => {
  it('uses a fresh reviewer and preserves the idea source for later questions', async () => {
    setEditor(editor('/workspace/src/Current.java', 'class Current { void execute() {} }'));
    harness.chat.mockImplementation(async (messages: ChatMessage[], model: string) => {
      const text = messages.map((message) => message.content).join('\n');
      return { model, fromMock: false, text: text.includes('[INTENT:improve]')
        ? 'IMPROVE: Tests | Exercise Current.execute | A visible method boundary | Compare two inputs to execute | XS'
        : text.includes('[INTENT:ideaverify]')
          ? 'VERIFY: 1 | supported | void execute() | Other coverage is unknown | Inspect test cases | Follow one input across the boundary'
          : 'Observation: execute has a boundary. Test two contrasting inputs before proposing a change.' };
    });
    const result = await send({ type: 'improve', lens: 'DX & Testing' }, 'improvements');
    const idea = (result.ideas as { id: string; verification: { level: string } }[])[0]!;
    expect(idea.verification.level).toBe('Context supported');
    expect(harness.chat).toHaveBeenCalledTimes(2);
    const reviewer = harness.chat.mock.calls[1]![0] as ChatMessage[];
    expect(reviewer).toHaveLength(2);
    expect(reviewer[0]!.content).toContain('not the author');
    setEditor(editor('/workspace/src/Other.java', 'class Other {}'));
    const response = await send({ type: 'ideaHelp', id: idea.id, requestId: 'help-1', mode: 'learn' }, 'ideaHelpReply');
    expect(response).toMatchObject({ id: idea.id, requestId: 'help-1' });
    const followup = harness.chat.mock.calls.at(-1)![0].map((message: ChatMessage) => message.content).join('\n');
    expect(followup).toContain('class Current');
    expect(followup).not.toContain('class Other');
    expect(followup).toContain('reusable spotting habit');
  });

  it('downgrades a missing verifier response instead of treating model agreement as proof', async () => {
    setEditor(editor('/workspace/src/Current.java', 'class Current { void execute() {} }'));
    harness.chat.mockImplementation(async (messages: ChatMessage[], model: string) => {
      if (messages.some((message) => message.content.includes('[INTENT:ideaverify]'))) throw new Error('offline');
      return { model, fromMock: false, text: 'IMPROVE: Tests | Exercise Current.execute | Check behaviour | Compare inputs | XS' };
    });
    const result = await send({ type: 'improve' }, 'improvements');
    const idea = (result.ideas as { verification: { level: string; challenge: string } }[])[0]!;
    expect(idea.verification.level).toBe('Speculation');
    expect(idea.verification.challenge).toContain('unavailable');
  });

  it('responds when ideas have expired or no code is available', async () => {
    const reply = await send({ type: 'ideaHelp', id: 'unknown', requestId: 'help-x', mode: 'learn' }, 'ideaHelpReply');
    expect(reply.text).toContain('expired');
    const missing = await send({ type: 'pocIdeas', seed: 'crashing tests' }, 'ideationError');
    expect(missing).toMatchObject({ target: 'pocIdeas' });
    expect(harness.chat).not.toHaveBeenCalled();
  });
});


describe('Ideation output quality gates', () => {
  it('substitutes a controlled failure-stage trial for a vague POC', async () => {
    setEditor(editor('/workspace/src/CurrentTest.java', 'void filtersPartners() { partnerService.findFiltered(scope, criteria); }'));
    harness.chat.mockImplementation(async (_messages: ChatMessage[], model: string) => ({ model, fromMock: false,
      text: 'POC: CurrentTest | Tests existing filtering | Filters partners | Run the same test | It passes' }));
    const response = await send({ type: 'pocIdeas', seed: 'crashing tests' }, 'pocIdeasResult');
    const trial = (response.pocs as { slice: string; demo: string; verification: { level: string } }[])[0]!;
    expect(trial.slice).toContain('first failing line');
    expect(trial.demo).toContain('reject order dependence');
    expect(trial.verification.level).toBe('Speculation');
  });

  it('returns a coherent everyday metaphor when the local model ignores the domain', async () => {
    setEditor(editor('/workspace/src/Current.java', 'findFiltered(scope, criteria);'));
    harness.chat.mockResolvedValue({ model: 'local', fromMock: false, text: 'Domain: Software Testing. Rename Partner to Recipe.' });
    const response = await send({ type: 'scamper', lens: 'Metaphor' }, 'scamperResult');
    expect(response.text).toContain('Library desk');
    expect(response.text).toContain('Limit:');
    expect(response.text).not.toContain('Recipe');
  });
});


describe('Learn background preparation', () => {
  it('returns the overview before review, prepares collapsed sections, and reuses them on expansion', async () => {
    setEditor(editor('/workspace/src/Current.java', 'class Current { void work() {} }'));
    let reviewDone!: (result: unknown) => void;
    harness.chat.mockImplementation(async (messages: ChatMessage[], model: string) => {
      if (messages.some((message) => message.content.includes('[INTENT:learnreview]'))) {
        return new Promise((resolve) => { reviewDone = resolve; });
      }
      return { model, fromMock: false, text: 'BOTTOM_LINE: Work grows with the input.\n### Count the work\nInspect one input at a time.' };
    });
    const overview = await send({ type: 'explainSelection' }, 'explanation');
    expect(overview.sessionId).toBeDefined();
    expect(harness.posts.filter((post) => post.type === 'concepts').at(-1)?.concepts).toEqual([]);
    expect(harness.posts.some((post) => post.type === 'deepDive' && post.kind === 'foundations')).toBe(false);
    expect(harness.posts.some((post) => post.type === 'deepStatus' && post.kind === 'foundations')).toBe(true);
    reviewDone({ model: 'local', fromMock: false, text: 'STATUS: ok\nEVIDENCE: void work()' });
    await vi.waitFor(() => expect(harness.posts.filter((post) => post.type === 'deepDive')).toHaveLength(4));
    // Explanations are never saved automatically; only Keep adds a card.
    expect(harness.posts.filter((post) => post.type === 'concepts').at(-1)?.concepts).toEqual([]);
    const calls = harness.chat.mock.calls.length;
    harness.handler?.({ type: 'deep', kind: 'foundations', sessionId: overview.sessionId });
    await Promise.resolve();
    expect(harness.chat.mock.calls).toHaveLength(calls);
  });

  it('suppresses a late overview from the previous selection', async () => {
    let oldDone!: (result: unknown) => void;
    harness.stream.mockImplementationOnce(() => new Promise((resolve) => { oldDone = resolve; }));
    setEditor(editor('/workspace/src/Old.java', 'class Old {}'));
    harness.handler?.({ type: 'explainSelection' });
    setEditor(editor('/workspace/src/New.java', 'class New {}'));
    harness.handler?.({ type: 'explainSelection' });
    oldDone({ model: 'local', fromMock: false, text: 'BOTTOM_LINE: Stale overview.\n### Old\nOld result.' });
    await vi.waitFor(() => expect(harness.posts.filter((post) => post.type === 'explanation')).toHaveLength(1));
    const answer = harness.posts.find((post) => post.type === 'explanation')!;
    expect(answer.sessionId).toBe('2');
    expect(JSON.stringify(answer)).not.toContain('Stale overview');
  });

  it('explains SQL LIKE directly rather than echoing its name through the model', async () => {
    setEditor(editor('/workspace/src/Search.java', 'public String normalizeSearch(String search) { return search.replace("%", "\\\\%"); }'));
    await send({ type: 'explainSelection' }, 'explanation');
    const calls = harness.chat.mock.calls.length;
    const answer = await send({ type: 'popupExplain', word: 'SQL LIKE' }, 'popupAnswer');
    expect(answer.text).toContain('zero or more');
    expect(answer.text).toContain('exactly one');
    expect(answer.text).toContain('Sam%');
    expect(harness.chat.mock.calls).toHaveLength(calls);
  });
});


it('does not retain an unverified overview as a fact when review is inconclusive', async () => {
  setEditor(editor('/workspace/src/Uncertain.java', 'class Uncertain { void work() {} }'));
  await send({ type: 'explainSelection' }, 'explanation');
  await vi.waitFor(() => expect(harness.posts.some((post) => post.type === 'explanationReview')).toBe(true));
  expect(harness.posts.find((post) => post.type === 'explanationReview')?.status).toBe('uncertain');
  expect(harness.posts.filter((post) => post.type === 'concepts').at(-1)?.concepts).toEqual([]);
});


it('renders Visualise directly without model calls and imports matching coverage', async () => {
  setEditor(editor('/workspace/src/Test.ts', 'function test(value) {\nif (value) { return api.send(value); }\n}'));
  const first = await send({ type: 'visualiseSelection' }, 'diagrams');
  expect(first.openDiagram).toBe(true);
  expect((first.diagrams as { availableTypes: string[] }).availableTypes).toContain('decisions');
  expect(harness.chat).not.toHaveBeenCalled();
  expect(harness.stream).not.toHaveBeenCalled();
  harness.window.showOpenDialog.mockResolvedValue([harness.uri('/reports/coverage-final.json')]);
  harness.workspace.fs.stat.mockResolvedValue({ size: 200, type: 1 });
  harness.workspace.fs.readFile.mockResolvedValue(new TextEncoder().encode(JSON.stringify({ '/workspace/src/Test.ts': { branchMap: { 0: { type: 'if', loc: { start: { line: 2 } } } }, b: { 0: [3, 0] } } })));
  const imported = await send({ type: 'loadCoverage' }, 'diagrams');
  const outcomes = (imported.diagrams as { decisions: { nodes: { kind: string; coverageState?: string }[] } }).decisions.nodes.filter(node => node.kind === 'assert');
  expect(outcomes.map(node => node.coverageState)).toEqual(['covered', 'missed']);
  expect(harness.chat).not.toHaveBeenCalled();
});


it('answers graph questions using the code and diagram snapshot, even after the editor changes', async () => {
  setEditor(editor('/workspace/src/First.java', 'class First { void work() { target.call(); } }'));
  await send({ type: 'visualiseSelection' }, 'diagrams');
  setEditor(editor('/workspace/src/Second.java', 'class Second {}'));
  harness.chat.mockResolvedValue({ model: 'local', fromMock: false, text: 'The line shows a source reference, not a measured runtime call.' });
  const reply = await send({ type: 'diagramQuestion', requestId: 'q1', diagramType: 'dataFlow', question: 'What does the line mean?' }, 'diagramAnswer');
  expect(reply.text).toContain('source reference');
  const prompt = harness.chat.mock.calls.at(-1)![0].map((message: ChatMessage) => message.content).join('\n');
  expect(prompt).toContain('class First');
  expect(prompt).not.toContain('class Second');
  expect(prompt).toContain('not proven runtime calls');
});


describe('Review holds only what the engineer chooses to keep', () => {
  const kept = () => harness.posts.filter((post) => post.type === 'concepts').at(-1)?.concepts as Record<string, unknown>[];
  const keep = async (path: string, code: string) => {
    setEditor(editor(path, code));
    await send({ type: 'explainSelection' }, 'explanation');
    await send({ type: 'mark' }, 'marked');
  };

  it('refuses to keep a card before anything has been explained', async () => {
    const refused = await send({ type: 'mark' }, 'markRefused');
    expect(String(refused.text)).toContain('Nothing to keep');
    expect(harness.posts.some((post) => post.type === 'marked')).toBe(false);
  });

  it('keeps nothing until asked, then saves a readable title with a plain-language status', async () => {
    setEditor(editor('/workspace/src/Chain.java', '  .stream()\n  .toList()'));
    const explained = await send({ type: 'explainSelection' }, 'explanation');
    expect(explained.term).toBe('stream().toList()');
    expect(explained.verify).toBeTruthy();
    expect(String((explained.verify as { engagementLine: string }).engagementLine)).toMatch(/Breakpoint|Try|DBeaver|Bruno/i);
    expect(kept()).toEqual([]);
    await send({ type: 'mark' }, 'marked');
    expect(kept()).toHaveLength(1);
    expect(kept()[0]).toMatchObject({ term: 'stream().toList()', status: 'new', statusLabel: 'New', shortFile: 'Chain.java', guessable: false });
    expect(kept()[0]?.bottomLine).toBe((explained.explanation as { bottomLine: string }).bottomLine);
  });

  it('includes a test map when a whole JUnit class is selected', async () => {
    const source = `class T {
      @BeforeEach void init() {}
      @Test void first() { assertTrue(a); }
      @Test void second() { assertEquals(1, b); }
    }`;
    setEditor(editor('/workspace/src/TTest.java', source));
    const explained = await send({ type: 'explainSelection' }, 'explanation');
    const outline = explained.testOutline as { tests: { name: string }[] };
    expect(outline.tests.map((entry) => entry.name)).toEqual(['first', 'second']);
  });

  it('infers a data layer for kept SQL and surfaces it in Today summary questions', async () => {
    const like = "OR LOWER(p.partner_name) LIKE '%' || LOWER(CAST(:search AS TEXT)) || '%' ESCAPE '\\\\'";
    setEditor(editor('/workspace/src/PartnerRepository.java', like));
    await send({ type: 'explainSelection' }, 'explanation');
    await send({ type: 'mark', term: 'partner search LIKE', bottomLine: 'LIKE does case-insensitive name matching with escaped wildcards.' }, 'marked');
    const card = kept()[0] as { layer: string; layerLabel: string; learningLayer?: string };
    expect(card.layer).toBe('data');
    expect(card.layerLabel).toBe('Data & persistence');
    const summary = await send({ type: 'summariseDay' }, 'reviewCard');
    expect(String(summary.text)).toMatch(/LIKE/i);
  });

  it('removes a card, restores it with undo, and can clear and restore the whole list', async () => {
    await keep('/workspace/src/One.java', 'class One { void work() {} }');
    await keep('/workspace/src/Two.java', 'class Two { void work() {} }');
    expect(kept()).toHaveLength(2);
    const id = String(kept().find((card) => card.term === 'One')!.id);
    expect(await send({ type: 'delete', id }, 'removed')).toMatchObject({ count: 1, term: 'One' });
    expect(kept().map((card) => card.term)).toEqual(['Two']);
    harness.handler?.({ type: 'undoDelete' });
    await vi.waitFor(() => expect(kept()).toHaveLength(2));
    expect(await send({ type: 'deleteAll' }, 'removed')).toMatchObject({ count: 2 });
    expect(kept()).toEqual([]);
    harness.handler?.({ type: 'undoDelete' });
    await vi.waitFor(() => expect(kept()).toHaveLength(2));
  });
});


it('persists a chosen drill layer and checks the answer against the question asked', async () => {
  setEditor(editor('/workspace/src/Store.java', 'class Store { void save() {} }'));
  await send({ type: 'explainSelection' }, 'explanation');
  await send({ type: 'mark' }, 'marked');
  const ledger = [...harness.posts].reverse().find(post => post.type === 'concepts')!;
  const concept = (ledger.concepts as { id: string }[])[0]!;
  const changed = await send({ type: 'setLearningLayer', id: concept.id, layer: 'data' }, 'concepts');
  expect((changed.concepts as { layer: string }[])[0]?.layer).toBe('data');
  harness.chat.mockResolvedValue({ text: 'What happens if a transaction fails midway?', model: 'local', fromMock: false });
  await send({ type: 'drill', id: concept.id }, 'drillQuestion');
  const prompt = harness.chat.mock.calls.findLast(call => call[0].some((m: ChatMessage) => m.content.includes('[INTENT:drill]')))![0];
  expect(prompt.map((m: ChatMessage) => m.content).join(' ')).toContain('Data & persistence');
  harness.chat.mockResolvedValue({ text: 'CORRECT\nChanges roll back.', model: 'local', fromMock: false });
  await send({ type: 'drillAnswer', id: concept.id, answer: 'Roll back.' }, 'drillVerdict');
  const grading = harness.chat.mock.calls.findLast(call => call[0].some((m: ChatMessage) => m.content.includes('[INTENT:drillcheck]')))![0];
  expect(grading.map((m: ChatMessage) => m.content).join(' ')).toContain('What happens if a transaction fails midway?');
});

it('uses selected code in Solve and checks an answer against the original question', async () => {
  setEditor(editor('/workspace/src/Failure.java', 'class Failure { void run() { service.call(); } }'));
  const selected = await send({ type: 'captureSolverSelection' }, 'solverSelection');
  expect((selected.context as { selection: string }).selection).toContain('service.call()');
  harness.chat.mockImplementation(async (messages: ChatMessage[], model: string) => ({
    model, fromMock: false,
    text: messages.some(m => m.content.includes('[INTENT:solver-check]')) ? 'The supplied code does not establish that; inspect the service call.' :
      'RESTATE: The call fails.\nCAUSE: The service might be null.\nCHECK: Set a breakpoint before the call.\nQUESTION: What value does service have?\nSTRATEGY: Inspect the local service variable in the debugger.\nEVIDENCE: service.call()\nWHY: The call dereferences service.\nUNKNOWN: No runtime value was supplied.',
  }));
  const reply = await send({ type: 'solve', mode: 'together', problem: 'The call fails', errorText: '', selection: selected.context }, 'solverReply');
  expect(reply.mode).toBe('together');
  const question = (reply.reply as { question: string }).question;
  setEditor(editor('/workspace/src/Other.java', 'class Other {}'));
  const checked = await send({ type: 'solverCheck', id: 'check-1', answer: 'service is null' }, 'solverCheckReply');
  expect(checked).toMatchObject({ id: 'check-1', fromMock: false });
  const call = harness.chat.mock.calls.findLast(args => args[0].some((m: ChatMessage) => m.content.includes('[INTENT:solver-check]')))!;
  const prompt = (call[0] as ChatMessage[]).map(m => m.content).join('\n');
  expect(prompt).toContain(question);
  expect(prompt).toContain('service.call()');
  expect(prompt).not.toContain('class Other');
});

it('visualises a complete multi-test selection instead of only the first 3,000 characters', async () => {
  const source = 'class Suite {\n@BeforeEach void setUp() {}\n' +
    Array.from({ length: 10 }, (_, index) => `@Test void test${index}() { /* ${'filler '.repeat(70)} */ assertThat(result${index}).isEqualTo(${index}); }\n`).join('') + '}';
  expect(source.length).toBeGreaterThan(3000);
  setEditor(editor('/workspace/src/Suite.java', source));
  const result = await send({ type: 'visualiseSelection' }, 'diagrams');
  const diagrams = result.diagrams as { testing: { nodes: { id: string; label: string }[] }; availableTypes: string[] };
  expect(diagrams.testing.nodes.filter(node => node.id.startsWith('junit:test:'))).toHaveLength(10);
  expect(diagrams.testing.nodes.some(node => node.label.includes('test9()'))).toBe(true);
  expect(diagrams.testing.nodes.some(node => node.label.includes('result9'))).toBe(true);
  expect(diagrams.availableTypes).not.toContain('sequence');
  const priorCount = harness.posts.length;
  await send({ type: 'explainSelection' }, 'explanation');
  const explained = harness.posts.slice(priorCount).find(post => post.type === 'diagrams')!;
  const explainedGraph = explained.diagrams as { testing: { nodes: { id: string; label: string }[] } };
  expect(explainedGraph.testing.nodes.some(node => node.label.includes('test9()'))).toBe(true);
});

it('builds separate safe recall questions from today’s kept ideas without model-generated facts', async () => {
  setEditor(editor('/workspace/src/Normalise.java', 'class Normalise { void normalizeSearch() {} }'));
  harness.stream.mockResolvedValue({ text: 'BOTTOM_LINE: SQL LIKE matches search patterns.\n### Wildcards\nThe percent sign matches multiple characters.', model: 'local', fromMock: false });
  await send({ type: 'explainSelection' }, 'explanation');
  await send({ type: 'mark' }, 'marked');
  harness.chat.mockClear();
  const card = await send({ type: 'summariseDay' }, 'reviewCard');
  const questions = card.questions as { question: string; source: string }[];
  expect(questions).toHaveLength(1);
  expect(questions[0]!.question).toContain('SQL LIKE');
  expect(questions[0]!.question).toContain('parameter binding');
  expect(questions[0]!.source).toContain('Normalise.java');
  expect(harness.chat).not.toHaveBeenCalled();
});

it('loads both explicitly named workspace test files and gives a grounded comparison', async () => {
  const root = process.cwd();
  const left = `${root}/src/solver/comparison.test.ts`;
  const right = `${root}/src/solver/solver.test.ts`;
  harness.workspace.getWorkspaceFolder.mockImplementation((uri: { fsPath: string }) =>
    uri.fsPath.startsWith(root + '/') ? { uri: harness.uri(root) } : undefined);
  harness.workspace.findFiles.mockImplementation(async (glob: string) => glob.includes('comparison.test.ts') ? [harness.uri(left)] : glob.includes('solver.test.ts') ? [harness.uri(right)] : []);
  harness.workspace.fs.stat.mockResolvedValue({ type: 1, size: 300 });
  harness.workspace.fs.readFile.mockImplementation(async (uri: { fsPath: string }) => new TextEncoder().encode(uri.fsPath === left
    ? 'class A { @Test void searchFilter() { repoService.findFiltered("acme"); assertThat(result).isEmpty(); } }'
    : 'class B { @Test void searchMatches() { partnerService.findFilteredInScope(scope); assertThat(result).isEmpty(); } }'));
  harness.chat.mockResolvedValue({ model: 'local', fromMock: false, text: 'RESTATE: No significant overlap.\nCAUSE: It is unclear.\nCHECK: Review the tests.' });
  const result = await send({ type: 'solve', mode: 'direct', problem: 'do these files not do alot of the same testing', errorText: `${left}\n${right}`, selection: null }, 'solverReply');
  const answer = result.reply as { cause: string; evidence: string[] };
  expect(answer.cause).toContain('searchFilter / searchMatches');
  expect(answer.cause).toContain('partnerService.findFilteredInScope()');
  expect(answer.cause).toContain('not proof');
  expect((result.sources as string[]).filter(source => source.startsWith('Workspace test excerpts:'))).toHaveLength(2);
  const prompt = (harness.chat.mock.calls.at(-1)![0] as ChatMessage[]).map(m => m.content).join('\n');
  expect(prompt).toContain('searchFilter');
  expect(prompt).toContain('searchMatches');
});


describe('Solve chat searcher', () => {
  const repo = () => {
    harness.workspace.findFiles.mockResolvedValue([harness.uri('/workspace/src/PartnerController.java')]);
    harness.workspace.fs.readFile.mockResolvedValue(new TextEncoder().encode('class PartnerController {\n  List<Partner> list() { return partnerService.findFilteredInScope(criteria).stream().toList(); }\n}'));
  };

  it('searches the repository and answers from cited lines', async () => {
    repo();
    harness.chat.mockResolvedValue({ model: 'local', fromMock: false, text: 'It is called at PartnerController.java:2. What does it return for empty criteria?' });
    const reply = await send({ type: 'chat', id: 'c1', text: 'Why does findFilteredInScope return nothing?', mode: 'pair', history: [] }, 'chatReply');
    expect(reply.sources).toEqual([{ file: 'src/PartnerController.java', line: 2 }]);
    const prompt = (harness.chat.mock.calls.at(-1)?.[0] as ChatMessage[]).map((message) => message.content).join('\n');
    expect(prompt).toContain('src/PartnerController.java:2');
  });

  it('anchors follow-ups and answers directly with one follow-up', async () => {
    repo();
    setEditor(editor('/workspace/src/PartnerController.java', 'class PartnerController {\n  List<Partner> list() { return partnerService.findFilteredInScope(criteria).stream().toList(); }\n}'));
    harness.chat.mockResolvedValue({ model: 'local', fromMock: false, text: 'LIKE matches names case-insensitively.\nFollow-up: Does ESCAPE apply here?' });
    const first = await send({ type: 'chat', id: 'cA', text: 'What does this LIKE do?', mode: 'answer', history: [] }, 'chatReply');
    expect(first.anchor).toContain('PartnerController.java');
    expect(first.text).toMatch(/follow-up:/i);
    expect(first.text).not.toMatch(/Try it yourself:/i);
    expect(first.engagement).toMatch(/Breakpoint|DBeaver|Bruno/i);
    harness.chat.mockResolvedValue({ model: 'local', fromMock: false, text: 'ESCAPE makes the backslash literal.\nFollow-up: Which input would you try?' });
    const second = await send({ type: 'chat', id: 'cB', text: 'What about ESCAPE?', mode: 'answer', history: [{ role: 'user', text: 'What does this LIKE do?' }] }, 'chatReply');
    expect(second.anchor).toBe(first.anchor);
  });

  it('lets the model ask the searcher for one more term', async () => {
    repo();
    harness.chat.mockResolvedValueOnce({ model: 'local', fromMock: false, text: 'SEARCH: partnerService' })
      .mockResolvedValueOnce({ model: 'local', fromMock: false, text: 'Found it. Which criteria reach it?' });
    const reply = await send({ type: 'chat', id: 'c2', text: 'Why does findFilteredInScope return nothing?', mode: 'vibe', history: [] }, 'chatReply');
    expect(reply.text).toBe('Found it. Which criteria reach it?');
    expect(reply.searched).toContain('partnerService');
  });

  it('turns text selected in the chat into an explanation context', async () => {
    harness.handler?.({ type: 'chatContext', text: 'stream().toList()' });
    await vi.waitFor(() => expect(harness.posts.some((post) => post.type === 'context')).toBe(true));
    expect(harness.posts.find((post) => post.type === 'context')?.context).toMatchObject({ file: 'Solve chat', selection: 'stream().toList()' });
  });

  it('loads a Cursor excerpt into Solve chat and keeps it as the chat anchor without editor selection', async () => {
    const excerpt = "OR LOWER(p.partner_name) LIKE '%' || LOWER(CAST(:search AS TEXT)) || '%' ESCAPE '\\\\'";
    const loaded = await send({ type: 'pasteFromCursor', excerpt, question: 'What does LIKE do here?' }, 'pasteResult');
    expect(loaded.ok).toBe(true);
    expect(loaded.label).toBe('Solve chat');
    expect(harness.posts.find((post) => post.type === 'context')?.context).toMatchObject({ file: 'Solve chat', selection: excerpt });
    harness.chat.mockResolvedValue({ model: 'local', fromMock: false, text: 'LIKE does a case-insensitive substring match.\nFollow-up: Which column would you test first?' });
    const reply = await send({ type: 'chat', id: 'cPaste', text: 'What does LIKE do here?', mode: 'answer', history: [] }, 'chatReply');
    expect(reply.anchor).toContain('Solve chat');
    expect(reply.anchor).toContain(`${excerpt.length} chars`);
    const prompt = (harness.chat.mock.calls.at(-1)?.[0] as ChatMessage[]).map((message) => message.content).join('\n');
    expect(prompt).toContain('LIKE');
  });

  it('skips noisy repository search for normal-form theory in Answer mode with a pasted anchor', async () => {
    const excerpt = 'Notes from Cursor about database design.';
    await send({ type: 'pasteFromCursor', excerpt, question: '1NF?' }, 'pasteResult');
    harness.chat.mockResolvedValue({ model: 'local', fromMock: false, text: '1NF: atomic values, no repeating groups.\nFollow-up: Do you see multi-valued columns?' });
    const reply = await send(
      { type: 'chat', id: 'c1nf', text: 'What is First Normal Form and how does it apply to this database?', mode: 'answer', history: [] },
      'chatReply',
    );
    expect(reply.searched).toEqual([]);
    expect(reply.engagement).toBe('');
    const prompt = (harness.chat.mock.calls.at(-1)?.[0] as ChatMessage[]).map((message) => message.content).join('\n');
    expect(prompt).toContain('no repository search — conceptual question only');
  });
});

describe('Ideate searches the repository before it challenges', () => {
  const query = "SELECT p.* FROM gpp.partner p WHERE (CAST(:status AS TEXT) = 'ACTIVE' AND p.partner_status = 'ACTIVE') OR (CAST(:status AS TEXT) = 'SUSPENDED') OR (CAST(:status AS TEXT) = 'OFFBOARDED') OR (CAST(:status AS TEXT) = 'IDP_CONFIGURED')";
  const repoFiles: Record<string, string> = {
    '/workspace/src/PartnerRepository.java': query,
    '/workspace/web/PartnerStatusFilter.tsx': "export const PARTNER_STATUS_OPTIONS = ['ACTIVE', 'SUSPENDED', 'OFFBOARDED', 'IDP_CONFIGURED'];\n",
    '/workspace/src/PartnerStatus.java': 'public enum PartnerStatus {\n  ACTIVE, SUSPENDED, OFFBOARDED;\n}\n',
  };

  it('finds the fixed list of statuses, shows it, and drops the question it already answers', async () => {
    setEditor(editor('/workspace/src/PartnerRepository.java', query));
    harness.workspace.findFiles.mockResolvedValue(Object.keys(repoFiles).map((path) => harness.uri(path)));
    harness.workspace.fs.readFile.mockImplementation(async (uri: { fsPath: string }) => new TextEncoder().encode(repoFiles[uri.fsPath] ?? ''));
    harness.chat.mockResolvedValue({ model: 'local', fromMock: false, text:
      'ASSUMPTION: The status parameter is a string.\nQUESTION: What happens if the status parameter contains an unexpected value?\nQUESTION: Which statuses do admins combine most often?\nCOUNTER: The query fails if status holds an invalid value.' });
    const reply = await send({ type: 'challengeIdea', id: 'i1', idea: 'combine several searches' }, 'challengeReply');
    const prompt = (harness.chat.mock.calls.at(-1)![0] as ChatMessage[]).map((message) => message.content).join('\n');
    expect(prompt).toContain('PartnerStatus is a fixed enum of 3 values: ACTIVE, SUSPENDED, OFFBOARDED');
    expect(prompt).toContain('PartnerStatusFilter.tsx');
    expect(reply.known).toEqual(expect.arrayContaining([expect.stringContaining('PartnerStatusFilter.tsx:1 lists ACTIVE, SUSPENDED, OFFBOARDED, IDP_CONFIGURED together')]));
    expect(reply.questions).toEqual(['Which statuses do admins combine most often?']);
    expect(reply.counter).toBe('');
    expect(reply.sources).toEqual(expect.arrayContaining([{ file: 'web/PartnerStatusFilter.tsx', line: 1 }, { file: 'src/PartnerStatus.java', line: 1 }]));
    expect(reply.searched).toEqual(expect.arrayContaining(['PartnerStatus']));
  });
});

it('rewrites the overview in place when the reviewer finds a problem but returns no rewrite', async () => {
  setEditor(editor('/workspace/src/Fix.java', 'class Fix { void work() {} }'));
  harness.chat.mockImplementation(async (messages: ChatMessage[], model: string) => {
    const text = messages.map((message) => message.content).join('\n');
    if (text.includes('[INTENT:learnreview]')) return { model, fromMock: false, text: 'STATUS: revise\nEVIDENCE: void work()\nISSUE: The overview calls work() a getter but it returns nothing.' };
    if (text.includes('REVIEWER CORRECTION')) return { model, fromMock: false, text: 'BOTTOM_LINE: work() is a void method; it returns nothing.\n### Void\nIt performs an action only.' };
    return { model, fromMock: false, text: 'BOTTOM_LINE: Placeholder.\n### Other\nOther.' };
  });
  await send({ type: 'explainSelection' }, 'explanation');
  await vi.waitFor(() => expect(harness.posts.some((post) => post.type === 'explanationReview' && post.status === 'revised')).toBe(true));
  const revised = harness.posts.find((post) => post.type === 'explanationReview' && post.status === 'revised')!;
  expect((revised.explanation as { bottomLine: string }).bottomLine).toContain('void method');
});


describe('Vibe solve writes only on request', () => {
  const source = 'class PartnerController {\n  List<Partner> list() { return found.stream().toList(); }\n}';
  const reply = 'Drop the stream.\nEDIT: src/PartnerController.java\nFIND:\n  List<Partner> list() { return found.stream().toList(); }\nREPLACE:\n  List<Partner> list() { return found.toList(); }\nEND';
  const setup = (text: string) => {
    harness.workspace.findFiles.mockResolvedValue([harness.uri('/workspace/src/PartnerController.java')]);
    harness.workspace.fs.readFile.mockResolvedValue(new TextEncoder().encode(source));
    harness.workspace.openTextDocument.mockResolvedValue({ getText: () => source, positionAt: (offset: number) => ({ offset }), lineCount: 3 });
    (harness.workspace as Record<string, unknown>).applyEdit = vi.fn().mockResolvedValue(true);
    harness.chat.mockResolvedValue({ model: 'local', fromMock: false, text });
  };

  it('validates the proposal, hides the raw block, and applies a WorkspaceEdit only after Apply', async () => {
    setup(reply);
    const answer = await send({ type: 'chat', id: 'v1', text: 'Simplify the found.stream() in list', mode: 'vibe', history: [] }, 'chatReply');
    const [proposal] = answer.proposals as { id: string; ok: boolean }[];
    expect(proposal).toMatchObject({ ok: true, file: 'src/PartnerController.java' });
    expect(String(answer.text)).not.toContain('FIND:');
    const apply = (harness.workspace as Record<string, ReturnType<typeof vi.fn>>).applyEdit!;
    expect(apply).not.toHaveBeenCalled();
    const result = await send({ type: 'applyEdit', id: proposal!.id }, 'editResult');
    expect(result.ok).toBe(true);
    const change = apply.mock.calls[0]![0] as { edits: unknown[][] };
    expect(change.edits[0]![2]).toBe('  List<Partner> list() { return found.toList(); }');
  });

  it('refuses an edit whose find text is not in the file', async () => {
    setup(reply.replace('found.stream().toList(); }\nREPLACE', 'missing.call(); }\nREPLACE'));
    const answer = await send({ type: 'chat', id: 'v2', text: 'Simplify the found.stream() in list', mode: 'vibe', history: [] }, 'chatReply');
    expect((answer.proposals as { ok: boolean; reason: string }[])[0]).toMatchObject({ ok: false });
    const apply = (harness.workspace as Record<string, ReturnType<typeof vi.fn>>).applyEdit!;
    expect(apply).not.toHaveBeenCalled();
  });
});


describe('Hand off to Cursor', () => {
  it('copies the problem and what was established, and opens Cursor chat through its prompt link', async () => {
    harness.openExternal.mockResolvedValue(true);
    const result = await send({ type: 'handoff', problem: 'Why is the partner list empty?', turns: [{ role: 'user', text: 'I think criteria is null' }] }, 'handoffResult');
    expect(result.opened).toBe(true);
    expect(harness.clipboard.mock.calls[0]![0]).toContain('I think criteria is null');
    expect(String(harness.openExternal.mock.calls[0]![0].path)).toContain('anysphere.cursor-deeplink/prompt');
  });
});


describe('Solve chat context follows you to the other tabs', () => {
  it('visualises and explains the text from the chat, and the editor Select takes over again', async () => {
    const code = 'public record PartnerFilterCriteria(String search, UUID productId) {}';
    harness.handler?.({ type: 'chatContext', text: code });
    const diagrams = await send({ type: 'visualiseSelection' }, 'diagrams');
    expect(String(diagrams.sourceLabel)).toContain('Solve chat');
    const explained = await send({ type: 'chatToLearn', text: code }, 'explanation');
    expect(explained.term).toBe('PartnerFilterCriteria');
    const fresh = await send({ type: 'visualiseSelection', fresh: true }, 'visualiseError');
    expect(String(fresh.text)).toContain('Open or select code');
  });
});
