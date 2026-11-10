import { extractFileReferences, selectFileMatches, type FileReference } from './solver-files';
import * as path from 'node:path';

export interface ComparedSource { path: string; text: string; }
export interface SourceComparison { sources: ComparedSource[]; issues: string[]; }

/** Brief source excerpts avoid silently overflowing the model's context window. */
export function testSourceExcerpt(source: string, budget = 7500): string {
  const chars = source.split('');
  for (let i = 0; i < source.length;) {
    const start = i;
    if (source.startsWith('//', i)) { i = source.indexOf('\n', i + 2); if (i < 0) i = source.length; }
    else if (source.startsWith('/*', i)) { const end = source.indexOf('*/', i + 2); i = end < 0 ? source.length : end + 2; }
    else if (source[i] === '"' || source[i] === "'") {
      const quote = source[i++];
      while (i < source.length) { if (source[i] === '\\') i += 2; else if (source[i++] === quote) break; }
    } else { i++; continue; }
    for (let j = start; j < Math.min(i, source.length); j++) if (chars[j] !== '\n' && chars[j] !== '\r') chars[j] = ' ';
  }
  const masked = chars.join('');
  const methods: { name: string; line: number; body: string; start: number }[] = [];
  for (const m of masked.matchAll(/@(?:[\w]+\.)*Test\b\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:(?:public|protected|private|final)\s+)*void\s+([\w$]+)\s*\([^)]*\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/g)) {
    const open = m.index + m[0].lastIndexOf('{');
    let end = open + 1, depth = 1;
    while (end < masked.length && depth) { if (masked[end] === '{') depth++; else if (masked[end] === '}') depth--; end++; }
    if (!depth) methods.push({ name: m[1]!, line: source.slice(0, m.index).split('\n').length, body: source.slice(open + 1, end - 1), start: open + 1 });
  }
  if (!methods.length) return `Source excerpt (test methods not recognised; remaining source omitted):\n${source.slice(0, budget)}`;
  const shown = methods.slice(0, 60);
  const names = shown.map((m) => `${m.name} (line ${m.line})`).join(', ');
  const header = `Test methods found in source: ${names}${methods.length > shown.length ? `; ${methods.length - shown.length} additional test methods omitted` : ''}\nSelected source excerpts below, not complete method bodies; other lines and setup are omitted.\n`;
  const perMethod = Math.max(60, Math.floor((budget - header.length) / shown.length));
  const snippets = shown.map((method) => {
    const lines = method.body.split('\n');
    const selected = new Set<number>();
    for (let i = 0; i < lines.length; i++) if (/assertThat|assert(?:Equals|True|False|Throws|Null|NotNull)|findFiltered|PartnerFilterCriteria|AuthorizationScope|setPartnerStatus|\.contains|\.isEmpty|\.isInstanceOf/.test(lines[i]!)) {
      selected.add(i);
      if (i + 1 < lines.length) selected.add(i + 1);
    }
    const startLine = source.slice(0, method.start).split('\n').length;
    let excerpt = [...selected].sort((a, b) => a - b).map((i) => `L${startLine + i}: ${lines[i]!.trim()}`).join('\n');
    if (!excerpt) excerpt = '(No recognised assertion or filter call excerpt.)';
    const prefix = `\n${method.name}:\n`;
    return prefix + (excerpt.length > perMethod ? `${excerpt.slice(0, Math.max(0, perMethod - 16))} [truncated]` : excerpt);
  });
  return header + snippets.join('');
}

/** A bounded, opt-in snapshot; the adapter must enforce workspace containment. */
export async function loadComparisonSources(
  problem: string,
  read: (reference: FileReference) => Promise<string>,
): Promise<SourceComparison | null> {
  if (!/\b(?:compar\w*|difference\w*|versus|vs\.?|which\s+(?:one|test|file)|better|rather than|overlap|duplicat\w*|redundan\w*|same\s+(?:testing|tests?|thing)|same.*testing)\b/i.test(problem)) return null;
  const references = extractFileReferences(problem);
  if (references.length !== 2 || !/test|spec/i.test(problem)) return null;
  if (references[0]!.path === references[1]!.path) {
    return { sources: [], issues: ['The same file was supplied twice; provide two different test files.'] };
  }
  const results = await Promise.all(references.map(async (ref) => {
    try {
      const source = await read(ref);
      const text = testSourceExcerpt(source);
      return { path: ref.path, text };
    } catch {
      return null;
    }
  }));
  const issues = references.filter((_, index) => !results[index]).map((ref) =>
    `Could not read ${ref.path}: it may be missing, ambiguous, outside the workspace, or larger than the supported limit.`);
  return { sources: results.filter((result): result is ComparedSource => result !== null), issues };
}

export interface WorkspaceSourceAccess {
  candidates(name: string, reference: FileReference): Promise<string[]>;
  workspaceRoot(candidate: string): string | undefined;
  canonical(path: string): Promise<string>;
  stat(path: string): Promise<{ isFile: boolean; size: number }>;
  read(path: string): Promise<Uint8Array>;
}

/** Resolve a unique path, then check its canonical location before bounded reads. */
export async function readConfinedTestSource(reference: FileReference, access: WorkspaceSourceAccess): Promise<string> {
  const name = reference.path.replace(/\\/g, '/').split('/').pop() ?? '';
  if (!/^[\w .@()+$-]+\.(?:java|tsx?|jsx?|mjs|cjs|py|go|rs|cs|kt|kts|scala|rb|php|swift)$/i.test(name)) throw new Error('Unsupported file');
  const candidates = await access.candidates(name, reference);
  if (candidates.length >= 300) throw new Error('Ambiguous path');
  const matches = selectFileMatches(reference, candidates.filter((candidate) => !!access.workspaceRoot(candidate)));
  if (matches.length !== 1) throw new Error('Missing or ambiguous file');
  const root = access.workspaceRoot(matches[0]!);
  if (!root) throw new Error('Outside workspace');
  const [resolvedRoot, resolved] = await Promise.all([access.canonical(root), access.canonical(matches[0]!)]);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Outside workspace');
  const stat = await access.stat(resolved);
  const maxBytes = 32 * 1024;
  if (!stat.isFile || stat.size > maxBytes) throw new Error('Not a bounded source file');
  const bytes = await access.read(resolved);
  if (bytes.byteLength > maxBytes) throw new Error('Source file changed size');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
