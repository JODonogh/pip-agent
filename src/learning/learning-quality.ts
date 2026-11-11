import { appendEvaluatorDiagnosticNote, logEvaluatorDiagnostic, logEvaluatorDrop, markExperimentalDraft } from '../platform/diagnostics';
import { evaluateExplanation } from '../shared/evaluator';
import { metaphorScaffold } from '../ideation/ideation';
import { conceptualDbTheoryWithoutSchema } from '../solver/searcher';
import { ANALOGY_DOMAINS } from './prompts';
import { parseSql, sqlCostFactors } from '../diagrams/sql';
import type { CodeContext, Explanation } from '../shared/types';

/** Format presentation math while leaving literal code (including SQL escapes) untouched. */
export function readableMath(text: string): string {
  return text.split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((part) => part.startsWith('`') ? part : part
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)')
    .replace(/\\(?:text|mathrm)\{([^{}]+)\}/g, '$1')
    .replace(/\\(?:times|cdot)\b/g, '×')
    .replace(/\\leq\b/g, '≤').replace(/\\geq\b/g, '≥')
    .replace(/\\log_?\{?2\}?/g, 'log₂')
    .replace(/\\[()[\]]/g, '')
    .replace(/\^\{2\}|\^2\b/g, '²')
  ).join('');
}

function likeEscaping(ctx: CodeContext): boolean {
  const code = `${ctx.selection.slice(0, 3000)}\n${ctx.surrounding.slice(0, 1200)}`;
  return /\.replace(?:All)?\s*\(/.test(code) && /["'][%_]["']/.test(code);
}

function vitestModuleMock(ctx: CodeContext): boolean {
  return /\bvi\s*\.\s*mock\s*\(/.test(ctx.selection);
}

function delegatesFetch(ctx: CodeContext): boolean {
  return /\bfetch\s*:\s*\(?\s*([\w$]+)\s*\)?\s*=>\s*(?:\{\s*return\s+)?(?:globalThis\s*\.\s*)?fetch\s*\(\s*\1\s*\)/.test(ctx.selection);
}

function cannotInferFakeNetwork(value: string): boolean {
  return !/\b(?:not|cannot|doesn't|isn't)\b[^.!?]{0,65}\b(?:mock|stub|fake|simulat|intercept)\w*/i.test(value) &&
    /\b(?:mock|stub|fake|simulat|intercept)\w*\b[^.!?]{0,65}\b(?:network|http|requests?|fetch)\b|\b(?:network|http|requests?|fetch)\b[^.!?]{0,65}\b(?:mocked|stubbed|faked|simulated|intercepted)\b/i.test(value);
}

/** An escape for LIKE metacharacters is not a demonstrated SQL-injection defence. */
export function guardExplanation(ctx: CodeContext, explanation: Explanation): Explanation {
  const clientFixture = vitestModuleMock(ctx) && delegatesFetch(ctx) && /\bcreateClient\s*\(/.test(ctx.selection);
  const codeDump = [explanation.bottomLine, ...explanation.chunks.map((chunk) => chunk.title)].some((value) =>
    value.length > 100 && /\bvi\s*\.\s*mock\s*\(|\bcreateClient\s*\(/.test(value) && /[{};]|=>/.test(value));
  const fix = (value: string): string => {
    let readable = readableMath(value);
    if (vitestModuleMock(ctx)) readable = readable.replace(/\bJest\b/g, 'Vitest');
    else if (/\bjest\s*\.\s*mock\s*\(/.test(ctx.selection)) readable = readable.replace(/\bVitest\b/g, 'Jest');
    if (delegatesFetch(ctx) && cannotInferFakeNetwork(readable)) {
      return 'The injected fetch callback delegates to the current fetch implementation; network isolation depends on a separate stub or interceptor, which this excerpt does not establish.';
    }
    if (!likeEscaping(ctx) || /\b(?:not|cannot|doesn't|isn't)\b[^.!?]{0,50}\b(?:prevent|protect|stop|avoid|mitigat)\w*/i.test(readable)) return readable;
    return /\b(?:prevent|protect|stop|avoid|mitigat)\w*\b[^.!?]{0,80}\bSQL injection\b/i.test(readable)
      ? 'This escapes LIKE wildcard characters; SQL injection protection depends on parameter binding, which this excerpt does not establish.'
      : readable;
  };
  if (clientFixture && codeDump) {
    logEvaluatorDrop('Model echoed executable fixture in chunk title or bottom line', JSON.stringify(explanation));
    return markExperimentalDraft(
      {
        ...explanation,
        bottomLine: fix(explanation.bottomLine),
        chunks: explanation.chunks.map((chunk) => ({
          title: readableMath(chunk.title),
          body: fix(chunk.body),
        })),
      },
      'guardExplanation',
      'Model echoed executable fixture in chunk title or bottom line',
      JSON.stringify(explanation),
    );
  }
  const source = `${ctx.selection}\n${ctx.surrounding}`.toLowerCase();
  const mentionsUnsupported = (value: string): boolean => {
    const text = value.toLowerCase();
    return (
      (/\b401\b/.test(text) && !source.includes('401')) ||
      (/\bexception\b/.test(text) && !source.includes('exception')) ||
      (/\b40[034]\b|\b500\b|\btimeout\b/.test(text) && !/(40[034]|500|timeout)/.test(source))
    );
  };
  const kept = explanation.chunks.filter(
    (chunk) => !mentionsUnsupported(`${chunk.title} ${chunk.body}`),
  );
  const dropped = kept.length !== explanation.chunks.length;
  let dropReason = '';
  if (dropped) {
    const removed = explanation.chunks
      .filter((chunk) => mentionsUnsupported(`${chunk.title} ${chunk.body}`))
      .map((chunk) => chunk.title)
      .join('; ');
    dropReason = 'Removed chunks mentioning status or exception not present in selection';
    logEvaluatorDrop(dropReason, removed);
    logEvaluatorDiagnostic('guardExplanation', dropReason, removed.slice(0, 400));
  }
  const bottomLineRaw = fix(explanation.bottomLine);
  let bottomLine = bottomLineRaw;
  if (mentionsUnsupported(bottomLineRaw)) {
    const reason = 'Bottom line mentions status or exception not present in selection';
    logEvaluatorDrop(reason, bottomLineRaw);
    bottomLine = appendEvaluatorDiagnosticNote(bottomLineRaw, reason);
  } else if (dropReason) {
    bottomLine = appendEvaluatorDiagnosticNote(bottomLineRaw, dropReason);
  }
  const chunks = kept.map((chunk) => ({ title: readableMath(chunk.title), body: fix(chunk.body) }));
  return { bottomLine, chunks, repaired: explanation.repaired || dropped || bottomLine !== explanation.bottomLine ||
    chunks.some((chunk, index) => chunk.body !== explanation.chunks[index]?.body || chunk.title !== explanation.chunks[index]?.title) };
}

/** Teach the boundary visible in this fixture, rather than inventing a time-complexity lesson. */
function moduleMockTeaching(ctx: CodeContext, kind: string): Explanation | null {
  if (!vitestModuleMock(ctx)) return null;
  const delegation = delegatesFetch(ctx);
  if (kind === 'foundations') return {
    bottomLine: 'The core idea is a test seam: replace a module boundary while deciding separately how its dependencies behave.',
    chunks: [
      { title: 'Module replacement is a test double', body: '`vi.mock` belongs to Vitest: its factory supplies the module replacement. A test double substitutes one boundary so the test can control or observe it; that does not imply every dependency behind the boundary is also simulated.' },
      { title: 'Dependency injection controls the transport seam', body: delegation ? 'The `fetch` option injects a callback into `createClient`. Because it calls the current `fetch`, it delegates transport behaviour; it is not itself a fake response. Injection creates a place to substitute behaviour, while a test must choose the substitute.' : 'Separate what the module factory replaces from what the replacement still calls. A test seam gives you a place to change a dependency; test isolation depends on the actual substitute and the observable boundary.' },
      { title: 'Check the test boundary', body: 'Draw module → client → transport. For each arrow, ask what runs and what is replaced. Then inject a known transport response and assert which callback receives the request; inspect wider setup before deciding whether networking is isolated.' },
    ], repaired: false,
  };
  if (kind === 'analogy' && !delegation) return {
    bottomLine: 'Think of a film-set prop desk: Vitest supplies a stand-in for the module, while the test exercises the scene around it.',
    chunks: [
      { title: 'Map the replacement', body: 'The factory is the prop desk, the returned exports are the stand-in props, and the consuming code is the scene using them. The test can control one boundary without rebuilding the whole production setting.' },
      { title: 'The analogy has a limit', body: 'Replacing a module does not prove all of its dependencies are simulated. Inspect what the factory returns and what those replacements still call before deciding what is isolated.' },
    ], repaired: false,
  };
  if (kind === 'analogy') return {
    bottomLine: 'Think of a film-set prop desk: Vitest replaces the client module as a prop, and the injected fetch callback is that prop’s courier.',
    chunks: [
      { title: 'Map the two boundaries', body: 'The module factory is the prop desk supplying a replacement object. The transport callback is the courier the prop uses. Giving that courier directions to the existing `fetch` does not automatically replace the delivery with an acted scene.' },
      { title: 'The analogy has a limit', body: 'A module replacement and a transport stub are separate decisions. This analogy illustrates those boundaries; it does not prove that any real request occurs or that a wider test setup has not already intercepted fetch.' },
      { title: 'Try the distinction', body: 'If you wanted a unit test that never reaches a server, which boundary would you explicitly replace, and what assertion would show the replacement was used?' },
    ], repaired: false,
  };
  if (/trade[- ]?off|performance/i.test(kind)) return {
    bottomLine: 'This excerpt establishes no performance bottleneck; the useful design trade-off is test fidelity versus isolation.',
    chunks: [
      { title: 'Benefit: a controllable boundary', body: delegation ? 'Passing the transport as a dependency lets a test provide known outcomes without changing client logic. Delegating to the existing transport can preserve more real behaviour when that is what an integration test needs to exercise.' : 'A module replacement gives the test control over the exports consumed by other code. Keeping the real module instead exercises more integration behaviour but may require more setup.' },
      { title: 'Cost: behaviour outside the test', body: delegation ? 'The displayed callback forwards to the current fetch implementation. Unless a separate stub or interceptor controls it, timing and external responses may affect the test. A module mock alone does not establish transport isolation.' : 'A module replacement can hide integration failures if its substitute behaves differently from the real module. Inspect which downstream dependencies still run before deciding what this test proves.' },
      { title: 'Choose according to the test’s purpose', body: 'For a unit test, inject a deterministic response and assert the request contract. For an integration test, use an intentionally controlled endpoint or interceptor. Verify the chosen boundary; do not claim faster execution without a measurement.' },
    ], repaired: false,
  };
  return null;
}

export function glossaryDefinition(ctx: CodeContext | null, word: string, question?: string): string | null {
  const term = word.trim().toLowerCase().replace(/[`]/g, '');
  const source = ctx ? `${ctx.selection}\n${ctx.surrounding}` : '';
  const relevantQuestion = !question || /\b(?:what|mean|work|explain|example|escape|wildcard|injection|prevent|safe|difference)\b/i.test(question);
  if (!relevantQuestion) return null;
  if (term === 'sql like' || term === 'like' && /sql|search|replace|criteria|query|%|_/i.test(source)) {
    if (question && /injection|prevent|safe/i.test(question)) return 'Escaping LIKE wildcards makes `%` and `_` literal pattern characters; it does not by itself prevent SQL injection. Parameter binding keeps user input separate from SQL syntax.';
    return "SQL LIKE matches text against a pattern: `%` means zero or more characters and `_` means exactly one, so `LIKE 'Sam%'` matches 'Sam' and 'Samantha'. Escaping a wildcard makes it literal, using the database’s configured escape character.";
  }
  if (term === 'sql injection') return 'SQL injection happens when input is interpreted as SQL syntax rather than data. Bound parameters prevent input from changing the query structure; escaping LIKE wildcards addresses pattern matching instead.';
  return null;
}

function likeAnalogyTeaching(): Explanation {
  return {
    bottomLine: 'Think of a stencil with stretchable holes for % and _; backslash marks literal cut-outs.',
    chunks: [
      {
        title: 'Map the pattern',
        body: '% is a stretchable hole and _ is a one-character hole; escaped symbols are fixed marks on the stencil.',
      },
      {
        title: 'Where the analogy stops',
        body: 'The stencil explains LIKE pattern matching only. Parameter binding keeps user input out of SQL syntax; wildcard escaping alone does not establish SQL injection protection.',
      },
    ],
    repaired: true,
  };
}

function analogyFallback(ctx: CodeContext): Explanation {
  if (likeEscaping(ctx)) return likeAnalogyTeaching();
  const [mapping, exercise] = metaphorScaffold(ctx).split('\n');
  return { bottomLine: mapping ?? 'Read the code as any number of metaphors, whatever most suits the particular code sample or question given',
    chunks: [{ title: 'Try the mapping', body: exercise ?? '' }], repaired: true };
}

/** Learn context is only a theory question (e.g. normal forms) with no table DDL or SQL — skip code templates in every deep section. */
function conceptualDatabaseTheoryDeep(kind: string): Explanation {
  const normKind = /^trade[- ]?off/i.test(kind) ? 'performance' : kind;
  if (normKind === 'analogy') {
    return {
      bottomLine:
        'Normalisation rules are like labelling every compartment in a storage unit with one kind of item only — no shoebox inside a sock drawer.',
      chunks: [
        {
          title: 'What maps where',
          body: 'Each compartment is a column: it should name one attribute and hold one kind of value per row. A drawer that secretly contains a list of phone numbers breaks that rule.',
        },
        {
          title: 'Where this analogy stops',
          body: 'It does not show your real keys, duplicates, or nullable columns. Those come only from your CREATE TABLE, Liquibase changes, or ORM mappings — paste one of those next.',
        },
        {
          title: 'Try it',
          body: 'Open any migration that defines a table. Point at a column that repeats as a subgroup (arrays, comma lists, JSON blobs of multiple facts) — that is what you restructure for First Normal Form.',
        },
      ],
      repaired: false,
    };
  }
  if (normKind === 'foundations') {
    return {
      bottomLine:
        'First Normal Form says each cell is atomic: one value per column per row, and no repeating groups of columns that should be their own rows.',
      chunks: [
        {
          title: 'Atomic cells',
          body: 'A field should not hold several independent facts in one string (comma-separated tags) or a nested list where the count varies by row.',
        },
        {
          title: 'No repeating groups',
          body: 'If columns repeat as phone1, phone2, phone3 or a variable-length list in one cell, the table is not describing the same relational shape row by row.',
        },
        {
          title: 'Apply it to your database',
          body: 'You need the actual table definitions: Liquibase/Flyway SQL, CREATE TABLE, or mapped entities. From that you mark columns that are multi-valued or duplicated groups and split them into tables or rows.',
        },
      ],
      repaired: false,
    };
  }
  if (normKind === 'roots') {
    return {
      bottomLine:
        'Relational normal forms grew out of Edgar F. Codd’s relational model (1970): store facts in tables with explicit keys instead of repeating navigational trees.',
      chunks: [
        {
          title: 'The problem',
          body: 'Early systems forced programs to walk chains and fixed groups of fields; changing one collection pattern rewrote many programs.',
        },
        {
          title: 'Codd and normalisation',
          body: 'The relational model separated logical tables from physical storage. Later work (including Kent, Date, and others) tightened rules such as atomic attributes (1NF) and dependencies.',
        },
        {
          title: 'The link',
          body: 'Your question names “our DB” but this selection has no table layout. Paste one real table definition to tie 1NF to a concrete column or key.',
        },
      ],
      repaired: false,
    };
  }
  return {
    bottomLine:
      'Theory questions about normal forms do not establish measured performance; the design trade-off is usually redundancy vs join cost once you split tables.',
    chunks: [
      {
        title: 'Benefit of stricter 1NF',
        body: 'Storing one fact per cell makes constraints and indexes meaningful: you can search and update one attribute without unparsing strings.',
      },
      {
        title: 'Cost after splitting',
        body: 'More tables and rows often mean more joins or lookups at read time; that cost depends on volume and indexes, which only show up with real schema and data.',
      },
      {
        title: 'When to measure',
        body: 'After you have DDL and representative data, compare query plans (EXPLAIN) and response time for hot paths before and after normalising — not from a prose question alone.',
      },
    ],
    repaired: false,
  };
}

/** Facts about the query that are visible in the text itself, so these lessons are grounded without a model call. */
function sqlTeaching(ctx: CodeContext, kind: string): Explanation | null {
  const sql = ctx.selection;
  if (!/\bSELECT\b[\s\S]*\bFROM\b/i.test(sql)) return null;
  const exists = /\bEXISTS\s*\(\s*SELECT/i.test(sql);
  const optional = /:\w+\s+IS\s+NULL\b|CAST\(\s*:\w+\s+AS\s+\w+\s*\)\s+IS\s+NULL\b|\(:\w+\s*=\s*(?:FALSE|TRUE)\s+OR/i.test(sql);
  if (/performance|trade[- ]?off/i.test(kind)) {
    const parsed = parseSql(sql);
    const factors = parsed ? sqlCostFactors(parsed).filter((factor) => factor.tone !== 'good').slice(0, 3) : [];
    if (!factors.length) return null;
    return { bottomLine: 'Several choices here trade simplicity for speed; none is proven slow without a query plan.', chunks: [...factors.map((factor) => ({ title: factor.title, body: factor.body })), { title: 'Check before changing', body: 'Run EXPLAIN (ANALYZE) on the common filter combinations with realistic data, then look for sequential scans and sorts on the largest tables. Change one thing at a time.' }], repaired: false };
  }
  if (kind === 'foundations' && exists) {
    const chunks: Explanation['chunks'] = [
      { title: 'Semi-join instead of join', body: 'EXISTS (SELECT 1 …) keeps a row when at least one match exists and stops looking. A JOIN returns one row per match, so a partner with two matching rows would appear twice and need DISTINCT.' },
    ];
    if (optional) chunks.push({ title: 'Optional filters as predicates', body: '`(:param IS NULL OR …)` is true for every row when the caller passes no value, so one statement stands for many filter combinations. The cost is a single plan shared by all of them.' });
    if (/IS\s+(?:NOT\s+)?NULL/i.test(sql)) chunks.push({ title: 'NULL means unknown', body: 'Comparing with NULL gives unknown, not true, so `= NULL` never matches. `IS NULL` is the only correct test, which is why “not deleted” is written `deleted_at IS NULL`.' });
    chunks.push({ title: 'Try it', body: 'Rewrite one EXISTS as a JOIN, then count rows for a partner with two matches and compare with the original. Which one needs DISTINCT, and why?' });
    return { bottomLine: 'This query asks yes/no questions with EXISTS (a semi-join) rather than joining the other tables, so each partner appears once.', chunks: chunks.slice(0, 4), repaired: false };
  }
  return null;
}

/** Known concepts can be taught reliably without waiting on local inference. */
export function preparedDeep(ctx: CodeContext, kind: string): Explanation | null {
  if (conceptualDbTheoryWithoutSchema(ctx)) return conceptualDatabaseTheoryDeep(kind);
  if (/\bAuthorizationScope\s*\.\s*All\s*\(/.test(ctx.selection)) {
    if (kind === 'analogy') return { bottomLine: 'Think of an unfiltered library catalogue: the catalogue view starts with every shelf visible.', chunks: [{ title: 'Map the idea', body: 'All is the catalogue view; a narrower scope is a view limited to some shelves. The caller and its filtering logic determine what is actually returned.' }, { title: 'Where it ends', body: 'A catalogue view is not a key to every locked room. Constructing this value alone does not prove a user has permission or that every operation is allowed.' }], repaired: false };
    if (kind === 'foundations') return { bottomLine: 'A scope is a value that can express a boundary separately from the code that applies it.', chunks: [{ title: 'Policy and mechanism', body: 'The scope represents a policy choice; the receiving code must interpret and enforce it. A named All value does not by itself perform authorization.' }, { title: 'Test the boundary', body: 'Compare the same operation with All and a narrower scope. Assert which records each may return, and check the actual authorization path before concluding access is unrestricted.' }], repaired: false };
    if (/trade[- ]?off|performance/i.test(kind)) return { bottomLine: 'The selection alone does not establish a performance or memory trade-off.', chunks: [{ title: 'A design choice to investigate', body: 'Compare an All scope with a narrower scope: the latter can limit returned records but requires correct scope propagation. Inspect the implementation and tests before claiming either is faster or secure.' }], repaired: false };
  }
  const sqlLesson = sqlTeaching(ctx, kind);
  if (sqlLesson) return sqlLesson;
  const moduleTeaching = moduleMockTeaching(ctx, kind);
  if (moduleTeaching) return moduleTeaching;
  if (!likeEscaping(ctx)) return null;
  if (kind === 'analogy') return likeAnalogyTeaching();
  if (kind.toLowerCase().includes('performance')) return {
    bottomLine: 'Separate literal string replacements favour clarity; each pass can scan and allocate another string.',
    chunks: [
      { title: 'What the clarity costs', body: 'With a fixed number of literal replacement passes, work grows with input length, O(n). Escaped output can grow, and intermediate strings may allocate memory. That describes growth, not a measured bottleneck.' },
      { title: 'When to try one pass', body: 'A combined scan could avoid intermediate strings, but must preserve replacement order and the meaning of the escape character. For short search terms, the clearer chain may be a better trade-off.' },
      { title: 'Measure before choosing', body: 'Compare both implementations on ordinary, long, and wildcard-heavy inputs. Check that outputs agree, then measure time and allocations. Keep the simpler version unless the measured saving matters.' },
    ], repaired: false,
  };
  if (kind === 'foundations') return {
    bottomLine: 'For a fixed number of literal replacement passes, work grows with the input length: O(n).',
    chunks: [
      { title: 'Count character visits', body: 'Let n be the input length. One complete scan of 8 characters visits 8 positions; scanning 16 visits 16. Two complete scans visit roughly 2 × n positions, before accounting for output expansion.' },
      { title: 'Time and allocation', body: 'A fixed number of these scans remains O(n), even when the constant multiplier differs. Escaped output may be longer and intermediate strings may allocate memory. These are growth estimates, not measured timings.' },
      { title: 'Recognise the pattern', body: 'Look for a fixed chain of whole-string operations. Count passes and ask whether output length can grow; benchmark real inputs before claiming that combining passes is faster.' },
    ], repaired: true,
  };
  return null;
}

export function evaluateDeep(raw: string, ctx: CodeContext, kind: string): Explanation {
  const prepared = preparedDeep(ctx, kind);
  if (prepared) return prepared;
  const parsed = guardExplanation(ctx, evaluateExplanation(raw));
  const text = [parsed.bottomLine, ...parsed.chunks.map((chunk) => chunk.body)].join(' ');
  const codeDump = [...raw.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].some((match) => (match[1]?.trim().length ?? 0) > 120);
  if (kind === 'foundations' && (codeDump ||
      !/\b(dependency injection|test seam|test double|test isolation|indirection|inversion|contract|invariant|immutab|referential|complexity|algorithm|data structure|linear|logarith|recurs|hash|queue|stack|tree|closure|polymorph|encapsulat|concurren|atomic|transaction|serializ|ownership|event loop|idempoten|separation of concerns|subquery|semi-join|predicate|relational|query plan|index|three-valued|set-based|declarative)\w*/i.test(text) ||
      !/\b(try|recognis|recogniz|apply|ask|check|contrast|compare|exercise|look for|use this|elsewhere|counterexample)\w*/i.test(text))) {
    const reason = codeDump
      ? 'foundations guard: model returned a code dump instead of a principle lesson'
      : 'foundations guard: missing transferable CS/design/testing vocabulary or transfer exercise';
    return markExperimentalDraft(parsed, 'foundations-grounding', reason, raw);
  }
  if (kind === 'analogy' && (!(ANALOGY_DOMAINS.some((domain) => domain.words.test(text)) || /\b(stencil|library|kitchen|cook|book|mail|rail|desk|gate|recipe|sieve|assembly|post|theatre|stage|factory|prop|courier)\w*/i.test(text)) ||
      !/\b(like|analogy|treat|think of|picture|imagine|maps?|represents?|corresponds?|as if)\b/i.test(text) ||
      !/\b(limit|unlike|does not|doesn't|cannot|breaks down|only illustrates)\b/i.test(text))) {
    return markExperimentalDraft(
      parsed,
      'analogy-grounding',
      'analogy guard: missing domain mapping, hedge language, or explicit limit',
      raw,
    );
  }
  if (/trade[- ]?off|performance/i.test(kind) && (
    !/\b(benefit|buys|clarity|readab|isolation|fidelity|saves|reduces)\w*/i.test(text) ||
    !/\b(cost|but|however|allocation|memory|latency|complexity|overhead|risk)\w*/i.test(text) ||
    !/\b(when|if|unless|prefer|choose|measure|benchmark|unit|integration)\w*/i.test(text))) {
    return markExperimentalDraft(
      parsed,
      'performance-tradeoff-grounding',
      'trade-off guard: model reply lacks benefit/cost/when structure',
      raw,
    );
  }
  return parsed;
}

function field(raw: string, name: string): string {
  return raw.split('\n').map((line) => line.trim()).find((line) => line.toUpperCase().startsWith(`${name}:`))?.slice(name.length + 1).trim() ?? '';
}

export interface LearningReview {
  status: 'supported' | 'revised' | 'uncertain';
  explanation?: Explanation;
  /** A concrete issue the reviewer found but did not rewrite; the host asks for a corrected overview. */
  correction?: string;
  text: string;
}

/** The model sometimes echoes the prompt's instructions as a section title; those are not content. */
export function dropEchoChunks(explanation: Explanation): Explanation {
  return { ...explanation, chunks: explanation.chunks.filter((chunk) => !/answer format|original answer|^chunks?\b/i.test(chunk.title.trim()) && chunk.body.trim().length > 0) };
}

/** A review only counts if it talks about things the source actually contains (no invented 401s, exceptions or timeouts). */
function issueIsGrounded(issue: string, ctx: CodeContext): boolean {
  const source = `${ctx.selection}\n${ctx.surrounding}`.toLowerCase();
  return (issue.match(/\b(?:\d{3}|throws?|exceptions?|errors?|timeouts?|retry|retries|cache[sd]?|null pointer)\b/gi) ?? [])
    .every((word) => source.includes(word.toLowerCase().replace(/(?:s|d)$/, '')));
}

export function evaluateLearningReview(raw: string, ctx: CodeContext, current: Explanation): LearningReview {
  const status = field(raw, 'STATUS').toLowerCase();
  const evidence = field(raw, 'EVIDENCE').replace(/^[`"“']|[`"”']$/g, '');
  const quoted = evidence.length >= 3 && evidence.length <= 300 &&
    [ctx.selection.slice(0, 3000), ctx.surrounding.slice(0, 1200)].some((source) => source.includes(evidence));
  if (!quoted) return { status: 'uncertain', text: 'The background reviewer supplied no matching source quote; the answer is unchanged.' };
  if (status === 'ok') return { status: 'supported', text: 'A separate reviewer found no grounded correction in this excerpt; no live test was run.' };
  const issue = field(raw, 'ISSUE');
  if (status !== 'revise' || issue.length < 8 || /^(?:none|n\/a|unknown)\b/i.test(issue)) {
    return { status: 'uncertain', text: 'The background review did not establish a concrete correction; the answer is unchanged.' };
  }
  if (!issueIsGrounded(issue, ctx)) {
    return { status: 'uncertain', text: 'The background reviewer raised a point that is not in this excerpt, so it was ignored; the answer is unchanged.' };
  }
  if (!/^\s*BOTTOM_LINE:\s*\S/m.test(raw)) {
    return { status: 'uncertain', correction: issue.slice(0, 300), text: 'The reviewer found an issue but returned no rewrite; the answer is unchanged.' };
  }
  const explanation = dropEchoChunks(guardExplanation(ctx, evaluateExplanation(raw)));
  if (!explanation.chunks.length
    || explanation.bottomLine.startsWith('The model did not lead')
    || explanation.bottomLine.includes('[Diagnostic Note: Evaluator check failed:')
    || JSON.stringify(explanation) === JSON.stringify(current)) {
    return { status: 'uncertain', text: 'The background reviewer did not return a usable correction; the answer is unchanged.' };
  }
  return { status: 'revised', explanation, text: `Background review revised a claim: ${issue.slice(0, 220)} Source clue: “${evidence}”. No live test was run.` };
}
