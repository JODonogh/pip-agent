import * as vscode from 'vscode';
import { LearnPanel } from './panel';
import { SidebarProvider } from './sidebar';
import { PipStore } from './store';
import { MockProvider, OllamaProvider } from './provider';
import {
  evaluateDuck,
  evaluateExplanation,
  evaluateQuickFire,
  firstAppFrame,
  MAX_DEPTH,
  parseApproaches,
  parseDrillVerdict,
  parseMcq,
  parseSolver,
} from './evaluator';
import { bestHint, grade } from './memory';
import { extractKeywords } from './keywords';
import { analyzeDiagrams } from './diagram';
import {
  convergePrompt,
  daySummaryPrompt,
  deepPrompt,
  divergePrompt,
  drillCheckPrompt,
  drillPrompt,
  duckPrompt,
  explainPrompt,
  mcqPrompt,
  popupPrompt,
  quickFirePrompt,
  scamperPrompt,
  solverPrompt,
  testSkeletonPrompt,
  type ExplainStyle,
} from './workers';
import { deriveVerify } from './verify';
import { assertLocalhost } from './types';
import { estimateTokens, type ChatMessage, type CodeContext, type Concept, type Explanation, type ProviderResult } from './types';
import { execFile, type ChildProcess } from 'node:child_process';

interface Transport {
  post(message: Record<string, unknown>): void;
}

const TOKEN_CAPS: Record<string, number> = {
  explainer: 380,
  'explainer-nested': 180,
  'quick-fire': 60,
  'rubber-duck': 120,
  drillmaster: 90,
  'drill-check': 90,
  popup: 70,
  solver: 220,
  deep: 340,
  diverge: 220,
  converge: 120,
  scamper: 200,
  mcq: 260,
  test: 400,
  summary: 160,
};

/**
 * Orchestrator: routes intents to workers, enforces contracts via the
 * deterministic evaluator, falls back to Mock when Ollama is down, records
 * observability. All model traffic is localhost-only (enforced in provider).
 */
export function activate(context: vscode.ExtensionContext): void {
  const store = new PipStore(context.globalState);
  const sidebar = new SidebarProvider(context.extensionUri, store);
  let codeContext: CodeContext | null = null;
  let lastBottomLine = '';
  let lastTerm = '';

  const explainCache = new Map<string, Explanation>();
  const popupCache = new Map<string, string>();
  let speechProcess: ChildProcess | null = null;

  // Awaited: the old fire-and-forget pkill raced and killed the NEW utterance.
  const stopSpeech = async (): Promise<void> => {
    speechProcess?.kill('SIGKILL');
    speechProcess = null;
    await new Promise<void>((resolve) => execFile('pkill', ['-x', 'say'], () => resolve()));
  };
  let solverTried: string[] = [];
  let solverProblem = '';
  let lastSolverCause = '';

  const runWorker = async (
    worker: string,
    modelSetting: 'pip.model' | 'pip.fastModel',
    messages: ChatMessage[],
  ): Promise<ProviderResult & { latencyMs: number }> => {
    const config = vscode.workspace.getConfiguration();
    const model = config.get<string>(modelSetting, 'mistral:latest');
    const started = Date.now();
    let result: ProviderResult;
    try {
      result = await new OllamaProvider(config.get<string>('pip.ollamaUrl', 'http://127.0.0.1:11434')).chat(
        messages,
        model,
        TOKEN_CAPS[worker] ?? 256,
      );
    } catch {
      result = await new MockProvider().chat(messages, model);
    }
    const latencyMs = Date.now() - started;
    await store.addStat({
      worker,
      model: result.model,
      latencyMs,
      estTokens: estimateTokens(result.text),
      costUsd: 0,
      fromMock: result.fromMock,
      at: Date.now(),
    });
    return { ...result, latencyMs };
  };

  const statLine = (r: ProviderResult & { latencyMs: number }, worker: string): Record<string, unknown> => ({
    type: 'stat',
    text: `${worker} · ${r.model}${r.fromMock ? ' (mock — Ollama not answering)' : ''} · ${r.latencyMs}ms · ~${estimateTokens(r.text)} tokens · $0.00 local`,
  });

  const captureContext = (): CodeContext | null => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      void vscode.window.showInformationMessage('PIP: select some code first, then explain it.');
      return null;
    }
    const doc = editor.document;
    const startLine = Math.max(0, editor.selection.start.line - 15);
    const endLine = Math.min(doc.lineCount - 1, editor.selection.end.line + 15);
    codeContext = {
      file: vscode.workspace.asRelativePath(doc.uri),
      line: editor.selection.start.line + 1,
      language: doc.languageId,
      selection: doc.getText(editor.selection).slice(0, 6000),
      surrounding: Array.from({ length: endLine - startLine + 1 }, (_, i) => doc.lineAt(startLine + i).text).join(
        '\n',
      ),
    };
    return codeContext;
  };

  let currentStyle: ExplainStyle = 'plain';

  const doExplain = async (transport: Transport, focus: string | undefined, depth: number): Promise<void> => {
    if (!codeContext) {
      transport.post({ type: 'status', text: 'Select code in the editor first.' });
      return;
    }
    transport.post({ type: 'status', text: 'Thinking locally… (diagrams below are instant)' });
    // The diagrams are deterministic — send them now, don't make them wait for the LLM.
    transport.post({ type: 'diagrams', diagrams: analyzeDiagrams(codeContext) });
    const cacheKey = `${codeContext.file}:${codeContext.line}:${focus ?? ''}:${currentStyle}:${codeContext.selection.length}`;
    const cached = explainCache.get(cacheKey);
    if (cached) {
      transport.post({
        type: 'explanation',
        explanation: cached,
        focus: focus ?? null,
        depth,
        hint: null,
        keywords: extractKeywords(cached.bottomLine),
        diagrams: analyzeDiagrams(codeContext),
        verify: deriveVerify(codeContext, analyzeDiagrams(codeContext)),
      });
      transport.post({ type: 'stat', text: 'explainer · cached (instant) · $0.00 local' });
      return;
    }
    // Stream the main explain so the first words land in ~1s, not after full generation.
    let result: (ProviderResult & { latencyMs: number }) | null = null;
    if (depth === 0) {
      const config = vscode.workspace.getConfiguration();
      const started = Date.now();
      let lastSent = 0;
      try {
        const streamed = await new OllamaProvider(
          config.get<string>('pip.ollamaUrl', 'http://127.0.0.1:11434'),
        ).chatStream(explainPrompt(codeContext, focus, currentStyle), config.get<string>('pip.model', 'mistral:latest'), 320, (acc) => {
          if (Date.now() - lastSent > 250) {
            lastSent = Date.now();
            transport.post({ type: 'streamPartial', text: acc });
          }
        });
        result = { ...streamed, latencyMs: Date.now() - started };
        await store.addStat({
          worker: 'explainer',
          model: streamed.model,
          latencyMs: result.latencyMs,
          estTokens: estimateTokens(streamed.text),
          costUsd: 0,
          fromMock: false,
          at: Date.now(),
        });
      } catch {
        result = null; // fall through to the non-streaming path (which falls back to Mock)
      }
    }
    result ??=
      depth > 0
        ? await runWorker('explainer-nested', 'pip.fastModel', explainPrompt(codeContext, focus, currentStyle))
        : await runWorker('explainer', 'pip.model', explainPrompt(codeContext, focus, currentStyle));
    const explanation = evaluateExplanation(result.text);
    explainCache.set(cacheKey, explanation);
    lastBottomLine = explanation.bottomLine;
    lastTerm = focus ?? codeContext.selection.split('\n')[0]?.trim().slice(0, 60) ?? 'concept';
    const hint = focus ? null : bestHint(store.concepts(), codeContext.selection, Date.now());
    const fullText = [explanation.bottomLine, ...explanation.chunks.map((c) => `${c.title} ${c.body}`)].join('\n');
    transport.post({
      type: 'explanation',
      explanation,
      focus: focus ?? null,
      depth,
      hint,
      keywords: extractKeywords(fullText),
      diagrams: analyzeDiagrams(codeContext),
      verify: deriveVerify(codeContext, analyzeDiagrams(codeContext)),
    });
    transport.post(statLine(result, 'explainer'));
    await store.addHistory(focus ?? codeContext.selection.slice(0, 120));
  };

  /** One message handler for both surfaces (sidebar home + beside panel). */
  const handleLearnMessage = (transport: Transport, message: { type: string; [key: string]: unknown }): void => {
    void (async () => {
      switch (message['type']) {
        case 'help':
          await vscode.commands.executeCommand('pip.showCommands');
          break;
        case 'stopSpeak':
          await stopSpeech();
          break;
        case 'getVoices': {
          // Canonical macOS voice names, straight from `say` (webview names differ and fail).
          execFile('say', ['-v', '?'], (err, stdout) => {
            if (err) {
              return;
            }
            const voices = stdout
              .split('\n')
              .map((line) => /^(.+?)\s{2,}([a-z]{2}[_-][A-Z]{2})/.exec(line.trim()))
              .filter((m) => m && (m[2] ?? '').startsWith('en'))
              .map((m) => (m?.[1] ?? '').trim())
              .filter(Boolean);
            transport.post({ type: 'voices', voices });
          });
          break;
        }
        case 'speak': {
          // One voice at a time: fully stop the old one BEFORE starting the new one.
          const text = String(message['text'] ?? '').slice(0, 600);
          const voice = String(message['voice'] ?? '').trim();
          if (process.platform === 'darwin' && text) {
            await stopSpeech();
            const args = voice ? ['-v', voice, '-r', '178', text] : ['-r', '178', text];
            speechProcess = execFile('say', args, (err) => {
              speechProcess = null;
              if (err && voice) {
                // Unknown voice name — retry with the system default rather than silence.
                speechProcess = execFile('say', ['-r', '178', text], () => {
                  speechProcess = null;
                });
              }
            });
          }
          break;
        }
        case 'solve':
        case 'solveNext': {
          if (message['type'] === 'solve') {
            solverProblem = String(message['problem'] ?? '');
            solverTried = [];
          } else if (lastSolverCause) {
            solverTried = [...solverTried, lastSolverCause];
          }
          const errorText = String(message['errorText'] ?? '');
          const frame = firstAppFrame(errorText);
          const result = await runWorker(
            'solver',
            'pip.fastModel',
            solverPrompt(codeContext, solverProblem, errorText, solverTried),
          );
          const reply = parseSolver(result.text);
          lastSolverCause = reply.cause;
          transport.post({ type: 'solverReply', reply, frame });
          transport.post(statLine(result, 'solver'));
          break;
        }
        case 'solveFixed':
          solverTried = [];
          lastSolverCause = '';
          transport.post({ type: 'solverDone', problem: solverProblem });
          break;
        case 'setStyle':
          currentStyle = (String(message['style'] ?? 'plain') as ExplainStyle) || 'plain';
          break;
        case 'deep': {
          if (!codeContext) break;
          const kind = String(message['kind'] ?? 'foundations');
          const result = await runWorker('deep', 'pip.model', deepPrompt(codeContext, kind));
          const explanation = evaluateExplanation(result.text);
          transport.post({
            type: 'deepDive',
            kind,
            explanation,
            keywords: extractKeywords(explanation.bottomLine),
          });
          transport.post(statLine(result, `deep:${kind}`));
          break;
        }
        case 'diverge': {
          if (!codeContext) break;
          const result = await runWorker('diverge', 'pip.fastModel', divergePrompt(codeContext));
          transport.post({ type: 'approaches', approaches: parseApproaches(result.text), fromMock: result.fromMock });
          transport.post(statLine(result, 'diverge'));
          break;
        }
        case 'converge': {
          if (!codeContext) break;
          const approach = String(message['approach'] ?? '');
          const result = await runWorker('converge', 'pip.fastModel', convergePrompt(codeContext, approach));
          transport.post({ type: 'convergeResult', approach, text: result.text.trim() });
          break;
        }
        case 'scamper': {
          if (!codeContext) break;
          const lens = String(message['lens'] ?? 'Reverse It');
          const result = await runWorker('scamper', 'pip.fastModel', scamperPrompt(codeContext, lens));
          transport.post({ type: 'scamperResult', lens, text: result.text.trim() });
          transport.post(statLine(result, `scamper:${lens}`));
          break;
        }
        case 'genTest': {
          if (!codeContext) break;
          const result = await runWorker('test', 'pip.model', testSkeletonPrompt(codeContext));
          transport.post({ type: 'testSkeleton', text: result.text.trim() });
          transport.post(statLine(result, 'test-designer'));
          break;
        }
        case 'brunoSend': {
          // Bruno-style API prod: localhost only, enforced exactly like model traffic.
          const baseRaw = String(message['baseUrl'] ?? 'http://localhost:8081');
          const method = String(message['method'] ?? 'GET').toUpperCase();
          const path = String(message['path'] ?? '/');
          try {
            const base = assertLocalhost(baseRaw);
            const url = new URL(path, base);
            const started = Date.now();
            const res = await fetch(url, { method });
            const body = (await res.text()).slice(0, 600);
            transport.post({ type: 'verifyResult', text: `${method} ${url.pathname} → ${res.status} in ${Date.now() - started}ms\n${body}` });
          } catch (error) {
            transport.post({
              type: 'verifyResult',
              text: `Request failed: ${error instanceof Error ? error.message : 'unknown error'} — is the backend running locally? That failure is itself the lesson: check the server, port, then the path.`,
            });
          }
          break;
        }
        case 'getToday': {
          const today = new Date().toDateString();
          const todays = store.concepts().filter((c) => new Date(c.createdAt).toDateString() === today);
          const review = store.review();
          transport.post({
            type: 'today',
            terms: todays.map((c) => c.term),
            review: review && new Date(review.date).toDateString() !== today ? review : null,
          });
          break;
        }
        case 'summariseDay': {
          const today = new Date().toDateString();
          const todays = store.concepts().filter((c) => new Date(c.createdAt).toDateString() === today);
          const pool = todays.length ? todays : store.concepts().slice(0, 8);
          if (!pool.length) {
            transport.post({ type: 'reviewCard', text: 'Nothing marked yet today — mark a concept first, then summarise.' });
            break;
          }
          const result = await runWorker('summary', 'pip.fastModel', daySummaryPrompt(pool));
          await store.saveReview({ date: new Date().toISOString().slice(0, 10), text: result.text.trim() });
          transport.post({ type: 'reviewCard', text: result.text.trim() });
          transport.post(statLine(result, 'day-summary'));
          break;
        }
        case 'popupExplain':
        case 'popupAsk': {
          if (!codeContext) {
            break;
          }
          const word = String(message['word'] ?? '');
          const question = message['type'] === 'popupAsk' ? String(message['question'] ?? '') : undefined;
          const cacheKey = `${codeContext.file}:${codeContext.line}:${word}:${question ?? ''}`;
          const hit = popupCache.get(cacheKey);
          if (hit) {
            transport.post({ type: 'popupAnswer', word, text: hit });
            break;
          }
          const result = await runWorker('popup', 'pip.fastModel', popupPrompt(codeContext, word, question));
          const text = evaluateQuickFire(result.text).text;
          popupCache.set(cacheKey, text);
          transport.post({ type: 'popupAnswer', word, text });
          transport.post(statLine(result, 'popup'));
          break;
        }
        case 'explainSelection': {
          const captured = captureContext();
          if (captured) {
            transport.post({ type: 'context', context: captured });
            await doExplain(transport, undefined, 0);
          }
          break;
        }
        case 'openBeside': {
          const captured = codeContext ?? captureContext();
          if (captured) {
            const panel = LearnPanel.show(context.extensionUri, captured);
            panel.onMessage((m) => handleLearnMessage(panel, m));
            panel.post({ type: 'context', context: captured });
            await doExplain(panel, undefined, 0);
          }
          break;
        }
        case 'explain':
          await doExplain(transport, undefined, 0);
          break;
        case 'explainWord': {
          const depth = Number(message['depth'] ?? 0);
          if (depth <= MAX_DEPTH && codeContext) {
            await doExplain(transport, String(message['word'] ?? ''), depth);
          }
          break;
        }
        case 'quick':
          if (codeContext) {
            const result = await runWorker(
              'quick-fire',
              'pip.fastModel',
              quickFirePrompt(codeContext, String(message['question'] ?? '')),
            );
            transport.post({ type: 'answer', kind: 'Quick-fire', text: evaluateQuickFire(result.text).text });
            transport.post(statLine(result, 'quick-fire'));
          }
          break;
        case 'duck':
          if (codeContext) {
            const result = await runWorker(
              'rubber-duck',
              'pip.fastModel',
              duckPrompt(codeContext, String(message['statement'] ?? '')),
            );
            transport.post({ type: 'answer', kind: 'Rubber duck', text: evaluateDuck(result.text).text });
            transport.post(statLine(result, 'rubber-duck'));
          }
          break;
        case 'mark': {
          if (!codeContext) {
            break;
          }
          const termRaw = String(message['term'] ?? '').trim();
          const term = termRaw || lastTerm || 'concept';
          const concept: Concept = {
            // Deterministic id: re-marking the same spot updates, never duplicates.
            id: `${term}|${codeContext.file}|${codeContext.line}`,
            term,
            bottomLine: String(message['bottomLine'] ?? '').trim() || lastBottomLine,
            file: codeContext.file,
            line: codeContext.line,
            createdAt: Date.now(),
            lastSeenAt: Date.now(),
            hits: 0,
            misses: 0,
            mastered: false,
          };
          await store.upsertConcept(concept);
          sidebar.refresh();
          transport.post({ type: 'marked', term, count: store.concepts().length });
          break;
        }
        default:
          break;
      }
    })();
  };

  const explainBesideCommand = async (): Promise<void> => {
    const captured = captureContext();
    if (!captured) {
      return;
    }
    const panel = LearnPanel.show(context.extensionUri, captured);
    panel.onMessage((m) => handleLearnMessage(panel, m));
    await doExplain(panel, undefined, 0);
  };

  sidebar.onMessage((message) => {
    void (async () => {
      if (['grade', 'delete', 'drill', 'drillAnswer', 'mcq'].includes(String(message['type']))) {
        const concepts = store.concepts();
        const concept = concepts.find((c) => c.id === String(message['id'] ?? ''));
        if (message['type'] === 'mcq' && concept) {
          const result = await runWorker('mcq', 'pip.fastModel', mcqPrompt(concept));
          const mcq = parseMcq(result.text);
          if (mcq) {
            sidebar.post({ type: 'mcqQuestion', id: concept.id, term: concept.term, mcq });
          } else {
            sidebar.post({ type: 'mcqQuestion', id: concept.id, term: concept.term, mcq: null });
          }
        } else if (message['type'] === 'drillAnswer' && concept) {
          const result = await runWorker(
            'drill-check',
            'pip.fastModel',
            drillCheckPrompt(concept, String(message['answer'] ?? '')),
          );
          const { verdict, gap } = parseDrillVerdict(result.text);
          await store.upsertConcept(grade(concept, verdict === 'CORRECT', Date.now()));
          sidebar.post({ type: 'drillVerdict', id: concept.id, verdict, gap });
          sidebar.refresh();
        } else if (message['type'] === 'grade' && concept) {
          await store.upsertConcept(grade(concept, message['gotIt'] === true, Date.now()));
          sidebar.refresh();
        } else if (message['type'] === 'delete' && concept) {
          await store.saveConcepts(concepts.filter((c) => c.id !== concept.id));
          sidebar.refresh();
        } else if (message['type'] === 'drill' && concept) {
          const result = await runWorker('drillmaster', 'pip.fastModel', drillPrompt(concept));
          sidebar.post({ type: 'drillQuestion', id: concept.id, term: concept.term, text: result.text.trim() });
        }
        return;
      }
      handleLearnMessage(sidebar, message);
    })();
  });

  const showCommands = async (): Promise<void> => {
    const pick = await vscode.window.showQuickPick(
      [
        { label: 'Explain selection (beside editor)', detail: 'Cmd+Shift+L — disposable panel next to your code', command: 'pip.explainSelection' },
        { label: 'Open PIP sidebar (Learn, Diagram, Flashcards, Drill)', detail: 'Click the PIP icon in the activity bar — no shortcut needed', command: 'pip.focusSidebar' },
        { label: 'PIP settings (Ollama URL, models)', detail: 'pip.ollamaUrl / pip.model / pip.fastModel', command: 'workbench.action.openSettings' },
      ],
      { placeHolder: 'PIP commands — pick one to run it' },
    );
    if (pick) {
      await vscode.commands.executeCommand(pick.command);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('pip.explainSelection', explainBesideCommand),
    vscode.commands.registerCommand('pip.showCommands', showCommands),
    vscode.commands.registerCommand('pip.focusSidebar', () => vscode.commands.executeCommand('pip.sidebar.focus')),
    vscode.window.registerWebviewViewProvider('pip.sidebar', sidebar),
  );
}

export function deactivate(): void {
  // Panels dispose themselves; state lives in globalState; timer lives/dies with the sidebar page.
}
