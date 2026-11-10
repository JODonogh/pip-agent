import type { Diagram } from './diagram';
import type { CodeContext } from '../shared/types';

export interface TestReadSetup {
  name: string;
  line: number;
}

export interface TestReadEntry {
  name: string;
  line: number;
  assertions: string[];
}

/** Compact index of JUnit tests in the selection — no model call, not execution evidence. */
export interface TestReadOutline {
  file: string;
  setup: TestReadSetup[];
  tests: TestReadEntry[];
  note: string;
}

/** Mask comments and literals while retaining offsets and line numbers. */
function maskJava(code: string): string {
  const chars = code.split('');
  const mask = (start: number, end: number) => {
    for (let i = start; i < end; i++) if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
  };
  for (let i = 0; i < code.length;) {
    const start = i;
    if (code.startsWith('//', i)) {
      i = code.indexOf('\n', i + 2);
      if (i < 0) i = code.length;
    } else if (code.startsWith('/*', i)) {
      const end = code.indexOf('*/', i + 2);
      i = end < 0 ? code.length : end + 2;
    } else if (code.startsWith('"""', i)) {
      i += 3;
      while (i < code.length && !code.startsWith('"""', i)) {
        if (code[i] === '\\') i++;
        i++;
      }
      i = Math.min(code.length, i + 3);
    } else if (code[i] === '"' || code[i] === "'") {
      const quote = code[i]!;
      i++;
      while (i < code.length) {
        if (code[i] === '\\') i += 2;
        else if (code[i++] === quote) break;
      }
    } else {
      i++;
      continue;
    }
    mask(start, Math.min(i, code.length));
  }
  return chars.join('');
}

type ParsedMethod = { annotation: string; name: string; start: number; open: number; end: number };

function parseJUnitMethods(code: string): ParsedMethod[] {
  const masked = maskJava(code);
  const methodPattern = /@(?:[\w]+\.)*(Test|BeforeEach)\b(?:\s*\([^)]*\))?\s*(?:@(?:[\w]+\.)*[\w]+(?:\s*\([^)]*\))?\s*)*(?:(?:public|protected|private|final|static|synchronized)\s+)*void\s+([\w$]+)\s*\([^)]*\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/g;
  const found: ParsedMethod[] = [];
  for (const match of masked.matchAll(methodPattern)) {
    const open = match.index! + match[0].lastIndexOf('{');
    let depth = 1;
    let end = open + 1;
    while (end < masked.length && depth) {
      if (masked[end] === '{') depth++;
      else if (masked[end] === '}') depth--;
      end++;
    }
    if (depth) continue;
    found.push({ annotation: match[1]!, name: match[2]!, start: match.index!, open, end });
  }
  return found;
}

function classScopes(masked: string): { start: number; end: number }[] {
  const classRanges: { start: number; end: number }[] = [];
  for (const declaration of masked.matchAll(/\b(?:class|interface|enum|record)\s+[\w$]+[^;{}]*\{/g)) {
    const open = declaration.index! + declaration[0].lastIndexOf('{');
    let depth = 1;
    let end = open + 1;
    while (end < masked.length && depth) {
      if (masked[end] === '{') depth++;
      else if (masked[end] === '}') depth--;
      end++;
    }
    if (!depth) classRanges.push({ start: open, end });
  }
  return classRanges;
}

function lineAt(ctx: CodeContext, position: number): number {
  return ctx.line + ctx.selection.slice(0, position).split('\n').length - 1;
}

function extractAssertions(code: string, masked: string, method: ParsedMethod, lineAtPos: (position: number) => number, max = 6): string[] {
  const body = masked.slice(method.open + 1, method.end - 1);
  const assertion = /\b(?:assertThatThrownBy|assertThat|assertEquals|assertTrue|assertFalse|assertThrows|assertNull|assertNotNull|assertSame|assertNotSame|assertArrayEquals|assertIterableEquals|assertAll|fail)\s*\(/g;
  const out: string[] = [];
  for (const match of body.matchAll(assertion)) {
    if (out.length >= max) break;
    const start = method.open + 1 + match.index!;
    let end = start;
    let parens = 0;
    let braces = 0;
    for (; end < method.end; end++) {
      const char = masked[end]!;
      if (char === '(') parens++;
      else if (char === ')') parens--;
      else if (char === '{') braces++;
      else if (char === '}') braces--;
      else if (char === ';' && parens === 0 && braces === 0) {
        end++;
        break;
      }
    }
    const source = code.slice(start, Math.min(end, method.end - 1)).trim();
    out.push(source.length > 160 ? `${source.slice(0, 157)}…` : source);
    void lineAtPos;
  }
  return out;
}

function parseCtx(ctx: CodeContext): { methods: ParsedMethod[]; masked: string; code: string } | null {
  if (!/java/i.test(ctx.language) && !/\.java$/i.test(ctx.file)) return null;
  const code = ctx.selection;
  if (!/@(?:[\w]+\.)*Test\b/.test(code)) return null;
  return { methods: parseJUnitMethods(code), masked: maskJava(code), code };
}

/** Readable map for Learn — jump to a test without reading the whole class. */
export function junitReadOutline(ctx: CodeContext): TestReadOutline | null {
  const parsed = parseCtx(ctx);
  if (!parsed) return null;
  const { methods, masked, code } = parsed;
  const tests = methods.filter((method) => method.annotation === 'Test');
  if (!tests.length) return null;
  const scopes = classScopes(masked);
  const scopeAt = (position: number) => scopes.filter((range) => range.start < position && position < range.end)
    .sort((a, b) => b.start - a.start)[0]?.start;
  const setup = methods.filter((method) => method.annotation === 'BeforeEach').slice(0, 8)
    .map((method) => ({ name: method.name, line: lineAt(ctx, method.start) }));
  const entries: TestReadEntry[] = tests.slice(0, 40).map((method) => ({
    name: method.name,
    line: lineAt(ctx, method.start),
    assertions: extractAssertions(code, masked, method, (position) => lineAt(ctx, position)),
  }));
  const omitted = tests.length > 40 ? `${tests.length - 40} more tests not listed` : '';
  const inherited = setup.length ? ' Shared @BeforeEach runs before each test in its class.' : '';
  return {
    file: ctx.file,
    setup,
    tests: entries,
    note:
      'Skim this map first; open one test in the editor, then use Select on that method only if you want a short explanation.' +
      inherited +
      (omitted ? ` ${omitted}.` : ''),
  };
}

/** Recognise basic JUnit methods and explicit assertions; not a Java parser or execution/coverage report. */
export function javaTestingDiagram(ctx: CodeContext): Diagram | null {
  const parsed = parseCtx(ctx);
  if (!parsed) return null;
  const { methods, masked, code } = parsed;
  const tests = methods.filter((method) => method.annotation === 'Test');
  const scopes = classScopes(masked);
  const scopeAt = (position: number) => scopes.filter((range) => range.start < position && position < range.end)
    .sort((a, b) => b.start - a.start)[0]?.start;
  const nodes: Diagram['nodes'] = [];
  const edges: Diagram['edges'] = [];
  const allSetup = methods.filter((method) => method.annotation === 'BeforeEach');
  const setup = allSetup.slice(0, 10);
  let omittedAssertions = 0;
  for (const method of setup) {
    nodes.push({
      id: `junit:setup:${method.start}`,
      kind: 'param',
      label: `@BeforeEach ${method.name}()`,
      sourceLine: lineAt(ctx, method.start),
      order: method.start,
      detail: 'JUnit setup method in this selection; runs before each test according to JUnit lifecycle rules.',
    });
  }
  for (const method of tests.slice(0, 60)) {
    const id = `junit:test:${method.start}`;
    nodes.push({
      id,
      kind: 'method',
      label: `@Test ${method.name}()`,
      sourceLine: lineAt(ctx, method.start),
      order: method.start,
      detail: 'Test method declared in the selected source. Its presence does not show whether it ran or passed.',
    });
    const scope = scopeAt(method.start);
    for (const before of setup) {
      if (scope !== undefined && scopeAt(before.start) === scope) {
        edges.push({ from: `junit:setup:${before.start}`, to: id, label: 'before each' });
      }
    }
    const body = masked.slice(method.open + 1, method.end - 1);
    const assertion = /\b(?:assertThatThrownBy|assertThat|assertEquals|assertTrue|assertFalse|assertThrows|assertNull|assertNotNull|assertSame|assertNotSame|assertArrayEquals|assertIterableEquals|assertAll|fail)\s*\(/g;
    let assertionCount = 0;
    for (const match of body.matchAll(assertion)) {
      if (assertionCount++ >= 6) {
        omittedAssertions++;
        continue;
      }
      const start = method.open + 1 + match.index!;
      let end = start;
      let parens = 0;
      let braces = 0;
      for (; end < method.end; end++) {
        const char = masked[end]!;
        if (char === '(') parens++;
        else if (char === ')') parens--;
        else if (char === '{') braces++;
        else if (char === '}') braces--;
        else if (char === ';' && parens === 0 && braces === 0) {
          end++;
          break;
        }
      }
      const source = code.slice(start, Math.min(end, method.end - 1)).trim();
      const assertionId = `junit:assert:${start}`;
      nodes.push({
        id: assertionId,
        kind: 'assert',
        label: source.length > 240 ? `${source.slice(0, 237)}…` : source,
        detail: `Assertion written in ${method.name}(); it is not proof that the test passed or that a branch was covered.`,
        sourceLine: lineAt(ctx, start),
        order: start,
      });
      edges.push({ from: id, to: assertionId, label: 'asserts' });
    }
  }
  const omitted = [
    tests.length > 60 ? `${tests.length - 60} additional tests` : '',
    allSetup.length > 10 ? `${allSetup.length - 10} additional setup methods` : '',
    omittedAssertions ? `${omittedAssertions} additional assertions in shown tests` : '',
  ].filter(Boolean);
  return {
    nodes,
    edges,
    language: ctx.language,
    caption:
      'JUnit tests, setup and explicit assertions found in the selected source. Setup links show methods declared in the same class; inherited setup may also apply. Assertions are not evidence of execution or branch coverage; load a coverage report for branch evidence. Select one test method to explore its flow.' +
      (omitted.length ? ` Omitted from this view: ${omitted.join(', ')}.` : ''),
  };
}
