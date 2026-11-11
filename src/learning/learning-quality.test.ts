import { describe, expect, it } from 'vitest';
import { evaluateDeep, evaluateLearningReview, glossaryDefinition, guardExplanation, readableMath } from './learning-quality';
import { deepPrompt, learningReviewPrompt, popupPrompt, selectionDeepCue } from './prompts';
import type { CodeContext, Explanation } from '../shared/types';

const ctx: CodeContext = {
  file: 'PartnerService.java', line: 30, language: 'java',
  selection: String.raw`String normalizeSearch(String search) {
    if (search == null || search.isBlank()) return null;
    return search.trim().replace("%", "\\%").replace("_", "\\_");
  }`, surrounding: '',
};
const current: Explanation = { bottomLine: 'This escapes LIKE wildcards.', chunks: [{ title: 'The pattern', body: 'Percent signs become literal.' }], repaired: false };
const promptText = (messages: ReturnType<typeof deepPrompt>) => messages.map((message) => message.content).join('\n');

describe('learn teaching contracts', () => {
  it('replaces the screenshot’s summary-only analogy with an actual mapping and its limit', () => {
    const result = evaluateDeep('BOTTOM_LINE: The PartnerService class normalizes search queries to prevent SQL injection.\n### normalizeSearch\nIt replaces characters for LIKE.', ctx, 'analogy');
    expect(result.bottomLine).toContain('stencil');
    expect(result.chunks.map((chunk) => chunk.body).join(' ')).toContain('one-character hole');
    expect(result.chunks.map((chunk) => chunk.body).join(' ')).toContain('Parameter binding');
  });

  it('keeps a real analogy for an operation without a prepared teaching template', () => {
    const result = evaluateDeep('BOTTOM_LINE: Think of this as a stencil with marked holes.\n### The marks\nThe percent sign is like a stretchable hole. The analogy does not describe query construction.', { ...ctx, selection: 'return value;' }, 'analogy');
    expect(result.bottomLine).toBe('Think of this as a stencil with marked holes.');
  });

  it('uses an operation-count example instead of unrelated escaped input strings', () => {
    const result = evaluateDeep(String.raw`BOTTOM_LINE: Linear cost.
### Worked Numeric Example
For n=8: Original search example\%_ and escaped search example\\%\\_.`, ctx, 'foundations');
    expect(result.chunks[0]?.body).toContain('8 positions');
    expect(result.chunks[0]?.body).toContain('2 × n');
    expect(JSON.stringify(result)).not.toContain('example');
    expect(result.chunks[1]?.body).toContain('not measured timings');
  });

  it('cleans math notation without damaging SQL escape literals', () => {
    const result = readableMath(String.raw`\(2 \times n\) and \frac{n}{2}`);
    expect(result).toContain('2 × n');
    expect(result).toContain('(n)/(2)');
    const code = String.raw`Inline: \(n^2\); ` + '`String p = "\\\\%";`';
    expect(readableMath(code)).toBe('Inline: n²; ' + '`String p = "\\\\%";`');
    const fence = '```java\nString p = "\\\\%";\n```';
    expect(readableMath(fence)).toBe(fence);
  });

  it('defines SQL LIKE rather than echoing that it appears in the code', () => {
    const definition = glossaryDefinition(ctx, 'LIKE');
    expect(definition).toContain('zero or more');
    expect(definition).toContain('exactly one');
    expect(definition).toContain("Sam%");
    expect(glossaryDefinition(ctx, 'SQL LIKE', 'Does this prevent SQL injection?')).toContain('does not by itself');
    expect(glossaryDefinition(ctx, 'SQL injection')).toContain('Bound parameters');
    expect(glossaryDefinition(ctx, 'LIKE', 'How do I index this table?')).toBeNull();
  });

  it('removes an unsupported SQL injection guarantee without rewriting unrelated code', () => {
    const answer = { ...current, bottomLine: 'The method escapes special characters to prevent SQL injection.' };
    expect(guardExplanation(ctx, answer).bottomLine).toContain('parameter binding');
    const unrelated = { ...ctx, selection: 'executePreparedQuery(boundValues);' };
    expect(guardExplanation(unrelated, answer).bottomLine).toBe(answer.bottomLine);
    expect(guardExplanation(ctx, { ...current, bottomLine: 'This does not prevent SQL injection.' }).bottomLine).toBe('This does not prevent SQL injection.');
  });

  it('drops 401/exception chunks that are not in a single-line LIKE selection', () => {
    const likeCtx = {
      file: 'PartnerRepo.sql', line: 12, language: 'sql',
      selection: `OR LOWER(p.partner_name) LIKE '%' || LOWER(CAST(:search AS TEXT)) || '%' ESCAPE '\\'`,
      surrounding: 'SELECT p.* FROM gpp.partner p',
    };
    const hallucinated = {
      bottomLine: 'This code returns a 401 response when the exception type fires.',
      chunks: [
        { title: 'The 401 response', body: 'The handler returns 401 for unauthorised callers.' },
        { title: 'The LIKE pattern', body: 'LOWER() normalises case and ESCAPE makes the backslash literal.' },
      ],
      repaired: false,
    };
    const guarded = guardExplanation(likeCtx, hallucinated);
    expect(guarded.chunks.map((chunk) => chunk.title)).not.toContain('The 401 response');
    expect(guarded.chunks.map((chunk) => chunk.title)).toContain('The LIKE pattern');
    expect(guarded.bottomLine).toContain('401');
    expect(guarded.bottomLine).toContain('[Diagnostic Note: Evaluator check failed:');
    expect(guarded.repaired).toBe(true);
  });

  it('asks for meaningful definitions, plain math, and a consistent analogy', () => {
    expect(promptText(popupPrompt(ctx, 'SQL LIKE'))).toContain('tiny concrete example');
    expect(promptText(deepPrompt(ctx, 'foundations'))).toContain('not LaTeX');
    expect(promptText(deepPrompt(ctx, 'analogy'))).toContain('stretchable holes');
    expect(promptText(deepPrompt(ctx, 'Trade-off: Performance'))).toContain('### Cost');
  });

  it('steers deep dives at debouncing and custom hooks instead of a hooks origin template', () => {
    const hookCtx = {
      ...ctx,
      selection: 'export function useDebouncedValue<T>(value: T, ms: number) {\n  const [v, setV] = useState(value);\n  useEffect(() => {\n    const id = setTimeout(() => setV(value), ms);\n    return () => clearTimeout(id);\n  }, [value, ms]);\n  return v;\n}',
    };
    const cue = selectionDeepCue(hookCtx.selection);
    expect(cue).toContain('Debouncing');
    expect(cue).toContain('React Hooks RFC');
    const roots = promptText(deepPrompt(hookCtx, 'roots'));
    expect(roots).toContain('contact bounce');
    expect(roots).toContain('Pattern focus');
    const foundations = promptText(deepPrompt(hookCtx, 'foundations'));
    expect(foundations.toLowerCase()).toContain('trailing-edge debounce');
    expect(foundations.toLowerCase()).toContain('macrotask');
    const perf = promptText(deepPrompt(hookCtx, 'Trade-off: Performance'));
    expect(perf).toContain('downstream work');
    expect(perf).toContain('Allocation');
    expect(perf).toContain('unmount');
  });
});

describe('independent learning review', () => {
  it('does not replace an answer without a matching code quote', () => {
    const review = evaluateLearningReview('STATUS: revise\nEVIDENCE: query.bind(search)\nISSUE: The claim is wrong.\nBOTTOM_LINE: New claim.\n### New\nNew detail.', ctx, current);
    expect(review.status).toBe('uncertain');
    expect(review.explanation).toBeUndefined();
  });

  it('accepts a concrete grounded correction and labels it as a review rather than a test', () => {
    const review = evaluateLearningReview('STATUS: revise\nEVIDENCE: search.trim()\nISSUE: Whitespace is trimmed before replacements.\nBOTTOM_LINE: Input is trimmed before wildcard escaping.\n### Order\nThe trim call precedes the replace calls.', ctx, current);
    expect(review.status).toBe('revised');
    expect(review.explanation?.bottomLine).toContain('trimmed');
    expect(review.text).toContain('No live test was run');
  });

  it('requires a usable correction and keeps the reviewer separate from the generator conversation', () => {
    expect(evaluateLearningReview('STATUS: revise\nEVIDENCE: search.trim()\nISSUE: none\nBOTTOM_LINE: Unsupported.', ctx, current).status).toBe('uncertain');
    expect(evaluateLearningReview('STATUS: ok\nEVIDENCE: search.trim()', ctx, current).status).toBe('supported');
    const prompt = promptText(learningReviewPrompt(ctx, current));
    expect(prompt).toContain('independent critical reviewer');
    expect(prompt).toContain('Do not rewrite merely for style');
    expect(prompt).toContain(ctx.selection);
  });
});


it('prepares known LIKE concepts without needing a model response', async () => {
  const { preparedDeep } = await import('./learning-quality');
  const ctx = { file: 'Search.java', line: 1, language: 'java', selection: 'return search.replace("%", "escapedPercent").replace("_", "escapedUnderscore");', surrounding: '' };
  expect(preparedDeep(ctx, 'analogy')?.bottomLine).toContain('stencil');
  expect(preparedDeep(ctx, 'foundations')?.chunks[0]?.body).toContain('8 positions');
  expect(preparedDeep(ctx, 'Trade-off: Performance')?.chunks[2]?.body).toContain('allocations');
  expect(preparedDeep({ ...ctx, selection: 'return value;' }, 'analogy')).toBeNull();
});


const moduleFixture: CodeContext = {
  file: 'client.test.ts', line: 15, language: 'typescript', surrounding: "import { vi } from 'vitest';",
  selection: `vi.mock('@example/client', async () => {
    const { createClient } = await import('@example/client-core');
    return {
      client: createClient({ fetch: request => fetch(request) }),
    };
  });`,
};

describe('module mock fundamentals', () => {
  it('teaches test seams and injection rather than repeating the fixture or inventing Big O', async () => {
    const { preparedDeep } = await import('./learning-quality');
    const lesson = preparedDeep(moduleFixture, 'foundations')!;
    const text = [lesson.bottomLine, ...lesson.chunks.map((part) => `${part.title} ${part.body}`)].join(' ');
    expect(lesson.bottomLine).toContain('test seam');
    expect(text).toContain('Vitest');
    expect(text).toContain('Dependency');
    expect(text).toContain('it is not itself a fake response');
    expect(text).toContain('assert which callback');
    expect(text).not.toMatch(/Jest|O\(n\)|8 characters|1024/);
    expect(text).not.toContain(moduleFixture.selection);
  });

  it('keeps the framework and transport claims accurate in the main overview too', () => {
    const answer = guardExplanation(moduleFixture, {
      bottomLine: 'Jest replaces the client module.',
      chunks: [{ title: 'Network setup', body: 'The mock simulates network requests using its fetch callback.' }], repaired: false,
    });
    expect(answer.bottomLine).toBe('Vitest replaces the client module.');
    expect(answer.chunks[0]?.body).toContain('delegates to the current fetch implementation');
    expect(answer.chunks[0]?.body).toContain('does not establish');
  });

  it('gives an analogy with two mapped boundaries and an explicit limitation', () => {
    const lesson = evaluateDeep('BOTTOM_LINE: This configures a client mock.\n### Setup\nThe async function returns a module.', moduleFixture, 'analogy');
    expect(lesson.bottomLine).toContain('film-set');
    expect(lesson.chunks[0]?.body).toContain('module factory');
    expect(lesson.chunks[0]?.body).toContain('transport callback');
    expect(lesson.chunks[1]?.body).toContain('does not prove');
  });

  it('explains a real test-design choice while declining an unsupported performance claim', () => {
    const lesson = evaluateDeep('BOTTOM_LINE: The mock is fast.\n### Performance\nThis improves performance.', moduleFixture, 'Trade-off: Performance');
    expect(lesson.bottomLine).toContain('no performance bottleneck');
    expect(lesson.bottomLine).toContain('fidelity versus isolation');
    expect(lesson.chunks.map((part) => part.title)).toEqual([
      'Benefit: a controllable boundary', 'Cost: behaviour outside the test', 'Choose according to the test’s purpose',
    ]);
  });

  it('does not invent a fetch seam for a module replacement without one', async () => {
    const { preparedDeep } = await import('./learning-quality');
    const plainModule = { ...moduleFixture, selection: "vi.mock('clock', () => ({ now: () => 0 }));" };
    expect(JSON.stringify(preparedDeep(plainModule, 'analogy'))).not.toContain('injected fetch');
  });

  it('rejects trade-off replies which merely restate the overview', () => {
    const lesson = evaluateDeep('BOTTOM_LINE: This function returns a value.\n### Return\nIt returns a value clearly.',
      { file: 'constant.ts', line: 1, language: 'typescript', selection: 'export const answer = 42;', surrounding: '' }, 'Trade-off: Performance');
    expect(lesson.bottomLine).toContain('[Diagnostic Note: Evaluator check failed:');
    expect(lesson.experimentalDraft).toBe(true);
  });

  it('asks for an applicable principle rather than forcing complexity analysis onto configuration', () => {
    const text = promptText(deepPrompt(moduleFixture, 'foundations'));
    expect(text).toContain('test seams');
    expect(text).toContain('Example format');
    expect(text).toContain('Dependency injection');
  });
});


it('declines a generic Foundations response that only echoes the selected function', () => {
  const context = { file: 'example.ts', line: 1, language: 'typescript', selection: 'export const double = (n: number) => n * 2;', surrounding: '' };
  const response = evaluateDeep('BOTTOM_LINE: The double function returns twice its input.\n### double\nIt takes n and returns n times two.', context, 'foundations');
  expect(response.bottomLine).toContain('[Diagnostic Note: Evaluator check failed:');
  expect(response.bottomLine).toContain('twice its input');
  expect(response.experimentalDraft).toBe(true);
});

it('accepts async debounce foundations without marking them experimental', () => {
  const context = {
    file: 'useDebouncedValue.ts', line: 1, language: 'typescript',
    selection: 'useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);',
    surrounding: '',
  };
  const response = evaluateDeep(
    'BOTTOM_LINE: Trailing-edge debounce coalesces bursts through macrotask scheduling.\n' +
      '### Event loop\nsetTimeout queues a timer; cleanup on unmount clears the handle so a stale closure cannot leak work after the component unmounts.\n' +
      'Compare firing on every keystroke versus after a quiet window.',
    context,
    'foundations',
  );
  expect(response.bottomLine).not.toContain('[Diagnostic Note: Evaluator check failed:');
  expect(response.experimentalDraft).not.toBe(true);
});

it('preserves a generic foundation with a defined principle and a transfer exercise', () => {
  const context = { file: 'example.ts', line: 1, language: 'typescript', selection: 'export const double = (n: number) => n * 2;', surrounding: '' };
  const response = evaluateDeep('BOTTOM_LINE: Referential transparency means an expression can be replaced by its value without changing behaviour.\n### The same input\nThe arithmetic expression has no visible state dependency. Try replacing double(3) with 6 in a caller and compare the result.', context, 'foundations');
  expect(response.bottomLine).toContain('Referential transparency');
});

it('declines code dumps masquerading as a foundations lesson', () => {
  const context = { file: 'example.ts', line: 1, language: 'typescript', selection: 'export const double = (n: number) => n * 2;', surrounding: '' };
  const response = evaluateDeep('BOTTOM_LINE: Check this algorithm.\n### Definition\nTry this code:\n```typescript\n' + 'const value = 1;\n'.repeat(12) + '```', context, 'foundations');
  expect(response.bottomLine).toContain('[Diagnostic Note: Evaluator check failed:');
  expect(response.experimentalDraft).toBe(true);
  expect(response.chunks[0]?.title).toBe('Definition');
});

it('repairs the live malformed overview that puts the whole mock fixture into a chunk title', () => {
  const dumpedTitle = moduleFixture.selection.replace(/\s+/g, ' ');
  const malformed = {
    bottomLine: 'The module is configured with a client.',
    chunks: [{ title: dumpedTitle, body: 'The configuration constructs a client with fetch.' }], repaired: true,
  };
  const answer = guardExplanation(moduleFixture, malformed);
  expect(answer.experimentalDraft).toBe(true);
  expect(answer.bottomLine).toContain('[Diagnostic Note: Evaluator check failed:');
  expect(answer.chunks[0]?.title).toContain('vi.mock');
  expect(answer.chunks[0]?.body).toContain('configuration constructs');
});

it('asks for a justified mechanism layer and avoids unsupported hardware speculation', () => {
  const prompt = promptText(deepPrompt(moduleFixture, 'foundations'));
  expect(prompt).toContain('Take one step down');
  expect(prompt).toContain('event-loop');
  expect(prompt).toContain('inspectable experiment');
  expect(prompt).toContain('not LaTeX');
});


it('teaches scope as a boundary without claiming the object grants permissions or measured performance', async () => {
  const { preparedDeep } = await import('./learning-quality');
  const ctx = { file: 'Auth.java', line: 1, language: 'java', selection: 'new AuthorizationScope.All()', surrounding: '' };
  const analogy = preparedDeep(ctx, 'analogy')!;
  expect(analogy.bottomLine).toContain('library');
  expect(JSON.stringify(analogy)).not.toContain('SQL injection');
  expect(preparedDeep(ctx, 'foundations')?.bottomLine).toContain('boundary');
  expect(preparedDeep(ctx, 'Trade-off: Performance')?.bottomLine).toContain('does not establish');
});
