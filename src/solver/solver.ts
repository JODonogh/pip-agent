import { parseSolver, type SolverReply } from '../shared/evaluator';
import type { CodeContext } from '../shared/types';
import type { SolverMode } from './prompts';
import type { ComparedSource } from './comparison';

export interface SolverInput {
  ctx: CodeContext | null;
  problem: string;
  errorText: string;
  sources: string[];
  comparedSources?: ComparedSource[];
}

export interface EvaluatedSolverReply extends SolverReply {
  reason: string;
  evidence: string[];
  unknown: string;
  strategy: string;
  observed?: boolean;
}

/** Treat restored webview state as untrusted bounded data, not a file to open. */
export function restoredSolverContext(value: unknown): CodeContext | null {
  if (!value || typeof value !== 'object') return null;
  const ctx = value as Record<string, unknown>;
  if (typeof ctx.file !== 'string' || typeof ctx.selection !== 'string' || !ctx.selection.trim() ||
      typeof ctx.surrounding !== 'string' || typeof ctx.language !== 'string' ||
      typeof ctx.line !== 'number' || !Number.isSafeInteger(ctx.line) || ctx.line < 1) return null;
  return { file: ctx.file.slice(0, 500), selection: ctx.selection.slice(0, 3000),
    surrounding: ctx.surrounding.slice(0, 1200), language: ctx.language.slice(0, 80), line: ctx.line };
}

/** Keep the prompt, evidence checks and source labels on the same bounded snapshot. */
export function solverInput(ctx: CodeContext | null, problem: string, errorText: string): SolverInput {
  const selection = ctx?.selection.slice(0, 3000) ?? '';
  const surrounding = ctx?.surrounding.slice(0, 1200) ?? '';
  const input: SolverInput = {
    ctx: ctx ? { ...ctx, selection, surrounding } : null,
    problem: problem.slice(0, 4000),
    errorText: errorText.slice(0, 2500),
    sources: [],
  };
  if (input.problem) input.sources.push(`Problem text (${input.problem.length} characters)`);
  if (input.errorText) input.sources.push(`Pasted error/log (${input.errorText.length} characters)`);
  if (ctx) {
    input.sources.push(`Editor excerpt: ${ctx.file}:${ctx.line} (${selection.length} characters)`);
    if (surrounding) input.sources.push(`Nearby editor code (${surrounding.length} characters)`);
  }
  return input;
}

function field(raw: string, name: string): string {
  return raw.split('\n').map((line) => line.trim()).find((line) =>
    line.toUpperCase().startsWith(`${name}:`),
  )?.slice(name.length + 1).trim() ?? '';
}

function suppliedText(input: SolverInput): string[] {
  return [input.problem, input.errorText, input.ctx?.selection ?? '', input.ctx?.surrounding ?? '', ...(input.comparedSources ?? []).map((file) => file.text)];
}

function unquote(text: string): string {
  const trimmed = text.trim();
  return /^(?:"[\s\S]*"|'[\s\S]*'|`[\s\S]*`|“[\s\S]*”)$/.test(trimmed)
    ? trimmed.slice(1, -1)
    : trimmed;
}

function evidenceFrom(raw: string, input: SolverInput): string[] {
  const texts = suppliedText(input);
  return [...new Set(field(raw, 'EVIDENCE').split(/\s*\|\s*/).map(unquote).filter((quote) =>
    quote.length >= 3 && quote.length <= 300 && texts.some((text) => text.includes(quote)),
  ))].slice(0, 3);
}

function firstClue(input: SolverInput): string[] {
  for (const text of [input.errorText, input.problem]) {
    const line = text.split('\n').map((part) => part.trim()).find(Boolean);
    if (line) return [line.slice(0, 180)];
  }
  return [];
}

interface MissingMethod {
  method: string;
  receiver: string;
  file: string;
  evidence: string[];
}

/** Recognise the diagnostic itself; do not infer a declaration from a call site. */
function missingJavaMethod(input: SolverInput): MissingMethod | null {
  const text = `${input.problem}\n${input.errorText}`;
  const cue = /error:\s*cannot find symbol/i.exec(text);
  const symbol = /symbol:\s*method\s+([\w$]+\([^\r\n)]*\))/.exec(text);
  const location = /location:\s+(?:variable\s+[\w$]+\s+of\s+type\s+|(?:class|interface)\s+)([\w.$]+(?:<[^>\r\n]*>)?)/.exec(text);
  if (!cue || !symbol?.[1] || !location?.[1]) return null;
  const file = /(?:[A-Za-z]:)?[\\/][^\r\n]*?\.java:\d+(?=[:\s]|$)/.exec(text)
    ?? /[\w.$-]+\.java:\d+(?=[:\s]|$)/.exec(text);
  return {
    method: symbol[1],
    receiver: location[1],
    file: file?.[0] ?? '',
    evidence: [cue[0], symbol[0], location[0]],
  };
}

/** Offer a useful next action even if the model omitted its validation strategy. */
function fallbackStrategy(input: SolverInput): string {
  const text = `${input.problem}\n${input.errorText}\n${input.ctx?.selection ?? ''}`;
  if (/\b(?:https?:\/\/|(?:GET|POST|PUT|PATCH|DELETE)\s+\/|http\s+(?:request|endpoint|response)|(?:api|rest)\s+(?:request|endpoint|call)|endpoint)\b/i.test(text)) {
    return 'Use Bruno to repeat the request and compare the response status and body with the expected result.';
  }
  if (input.ctx?.selection) return 'Set a breakpoint near the failure, inspect the relevant inputs and compare the observed values with the expected behavior.';
  return 'Reproduce the issue with a small example and compare the actual result with the expected result.';
}

/** Explain this common relationship-test shape only when all three steps are visible. */
function explainLinkedTest(input: SolverInput): EvaluatedSolverReply | null {
  if (!/\b(?:how|why|explain)\b/i.test(input.problem) || !/\btest\b/i.test(input.problem)) return null;
  const code = [input.ctx?.selection ?? '', input.problem, input.errorText].join('\n');
  const link = /\b([\w$]+Repository)\s*\.\s*save\s*\(\s*([\w$]+)\s*\.\s*builder\s*\(\s*\)([\s\S]*?)\.\s*build\s*\(\s*\)/.exec(code);
  if (!link) return null;
  const body = link[3]!;
  const partnerMatch = /\.partner\s*\(\s*((?:this\.)?[\w$]+)\s*\)/.exec(body);
  const partner = partnerMatch?.[1];
  const product = /\.product\s*\(\s*((?:this\.)?[\w$]+)\s*\)/.exec(body)?.[1];
  if (!partner || !product) return null;
  const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const productId = new RegExp(`${escaped(product)}\\s*\\.\\s*getId\\s*\\(\\s*\\)`).exec(code)?.[0];
  const expectedId = new RegExp(`\\.containsExactly\\s*\\(\\s*${escaped(partner)}\\s*\\.\\s*getId\\s*\\(\\s*\\)\\s*\\)`).exec(code)?.[0];
  if (!productId || !expectedId || !new RegExp(`(?:FilterCriteria|findFiltered)[^;]*${escaped(productId)}`, 's').test(code)) return null;
  return {
    restate: 'How does this test check the relationship?',
    cause: `The test saves a ${link[2]} linking ${partner} to ${product}, filters using ${productId}, then expects exactly ${partner}'s ID in the result.`,
    confidence: 'possible', observed: true, check: 'Run the test and inspect the filter result.', question: '',
    evidence: [link[0].slice(0, link[0].indexOf('(')), partnerMatch![0], expectedId],
    reason: 'The saved relationship, product ID passed to the filter and expected result connect the setup to the assertion.',
    unknown: 'This positive example alone does not establish behavior for every linked or unlinked partner.',
    strategy: 'Add an unlinked partner and assert it is excluded, then run the test.',
  };
}

/** Ground a useful minimum comparison when a model gives no concrete answer. */
function comparisonFallback(input: SolverInput): EvaluatedSolverReply | null {
  const files = input.comparedSources;
  if (files?.length !== 2) return null;
  const names = files.map((file) => [...file.text.matchAll(/\b([\w$]+) \(line \d+\)/g)].map((match) => match[1]!));
  if (!names[0]?.length || !names[1]?.length) return null;
  const groups = [
    { label: 'search', pattern: /search/i },
    { label: 'status', pattern: /status/i },
    { label: 'product', pattern: /product/i },
    { label: 'scope', pattern: /scope/i },
  ];
  const examples = groups.flatMap(({ label, pattern }) => {
    const words = (name: string) => new Set(name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2));
    const pairs = names[0]!.filter((name) => pattern.test(name)).flatMap((left) => names[1]!.filter((name) => pattern.test(name)).map((right) => {
      const a = words(left), b = words(right);
      const overlap = [...a].filter((word) => b.has(word)).length;
      return { label, left, right, score: overlap / Math.max(1, a.size + b.size - overlap) };
    })).sort((a, b) => b.score - a.score);
    return pairs[0] ? [pairs[0]] : [];
  }).slice(0, 3);
  if (!examples.length) return null;
  const leftFile = files[0]!.path.split(/[\\/]/).pop();
  const rightFile = files[1]!.path.split(/[\\/]/).pop();
  const shared = examples.map((item) => `${item.label} (${item.left} / ${item.right})`).join('; ');
  // Name the tested entry points only when each call is visible in the excerpts.
  const entry = (text: string) => /\b(?:this\.)?([\w$]*(?:Repository|Service))\s*\.\s*(findFiltered(?:InScope)?)\s*\(/i.exec(text);
  const leftEntry = entry(files[0]!.text), rightEntry = entry(files[1]!.text);
  const distinction = leftEntry && rightEntry ? ` ${leftFile} calls ${leftEntry[1]}.${leftEntry[2]}(); ${rightFile} calls ${rightEntry[1]}.${rightEntry[2]}().` : '';
  return {
    restate: `Compare ${leftFile} and ${rightFile}.`,
    cause: `Both files name tests around ${shared}.${distinction} These are overlapping themes, not proof that the tests are duplicates.`,
    confidence: 'possible', check: 'Compare each pair’s setup, inputs and assertions before removing a test.', question: '',
    reason: 'The named tests are present in the supplied source excerpts.',
    evidence: [examples[0]!.left, examples[0]!.right],
    unknown: 'Only selected excerpts were compared; method names alone cannot establish identical behavior or replace checking the full tests.',
    strategy: 'Inspect the paired tests and retain cases that exercise different layers or behavior.',
  };
}

/** Model rationales are short explanations, never a substitute for quoted input. */
export function evaluateSolver(raw: string, input: SolverInput, tried: readonly string[] = [], mode: SolverMode = 'together'): EvaluatedSolverReply {
  if (mode === 'direct' && /(?:unclear|not enough|cannot determine|can.t determine|review the test names|(?:no|not|no significant)\s+(?:substantial\s+|significant\s+)?overlap|different purposes)/i.test(raw)) {
    const fallback = comparisonFallback(input);
    if (fallback) return fallback;
  }
  const linkedExplanation = mode === 'direct' ? explainLinkedTest(input) : null;
  if (linkedExplanation) return linkedExplanation;
  const reply = parseSolver(raw);
  const evidence = evidenceFrom(raw, input);
  const diagnostic = missingJavaMethod(input);
  const result: EvaluatedSolverReply = {
    ...reply,
    question: mode === 'direct' ? '' : reply.question,
    strategy: field(raw, 'STRATEGY').slice(0, 400) || fallbackStrategy(input),
    confidence: evidence.length ? reply.confidence : 'long shot',
    reason: evidence.length
      ? field(raw, 'WHY').slice(0, 320) || 'These supplied clues suggest the hypothesis; they do not verify the cause.'
      : 'The model did not supply a matching quote for this hypothesis; its cause is unverified.',
    evidence: evidence.length ? evidence : firstClue(input),
    unknown: field(raw, 'UNKNOWN').slice(0, 320) || 'The cause has not been verified against the implementation or a running check.',
  };
  if (!diagnostic) return result;

  result.restate = `Java compilation cannot resolve \`${diagnostic.receiver}.${diagnostic.method}\`${diagnostic.file ? ` at \`${diagnostic.file}\`` : ''}.`;
  if (tried.length) return result;
  return {
    ...result,
    cause: `The compile-time type \`${diagnostic.receiver}\` may not expose an accessible \`${diagnostic.method}\` for these argument types.`,
    confidence: 'possible',
    check: `Inspect \`${diagnostic.receiver}\` and its inherited methods for \`${diagnostic.method}\`; compare the name, visibility and argument types.`,
    question: mode === 'together' ? `What declaration or inherited method does \`${diagnostic.receiver}\` expose for \`${diagnostic.method.split('(')[0]}\`?` : '',
    strategy: 'Inspect the declaration and compile classpath, then rebuild the affected test. No check has been run.',
    reason: '`error: cannot find symbol` identifies a compilation diagnostic; `symbol: method` and `location` identify the unresolved call and receiver type.',
    evidence: diagnostic.evidence,
    unknown: 'The diagnostic alone does not establish the declaration, inherited API or build classpath; a parameter-count mismatch is not established.',
  };
}

const SOLVER_TOPICS = [
  'overload resolution', 'type erasure', 'classpath', 'compile-time type', 'runtime type',
  'dependency injection', 'race condition', 'deadlock', 'thread safety', 'memory visibility',
  'nullability', 'virtual dispatch', 'dynamic dispatch', 'generic bounds', 'type inference',
  'transaction isolation', 'optimistic locking', 'lazy loading', 'circular dependency',
  'binary compatibility', 'method resolution', 'access control',
];

/** Offer explanations for diagnostic concepts, not filenames or arbitrary identifiers. */
export function solverKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  return SOLVER_TOPICS.filter((topic) => {
    const pattern = topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`, 'u').test(lower);
  });
}
