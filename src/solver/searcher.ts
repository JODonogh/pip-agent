/**
 * The searcher: a deterministic repository search the Solve chat runs before the model answers,
 * so replies cite real file:line evidence instead of guessing. No model call is needed to search.
 */

export interface SearchFile {
  path: string;
  text: string;
}

export interface SearchHit {
  file: string;
  line: number;
  snippet: string;
  score: number;
}

const STOP = new Set(
  ('about above after again also and any are because been before being below between both but can could did does doing done down during each ' +
    'few for from further had has have having here how into its just like make more most must not now off once only other our out over own ' +
    'same should some such than that the their them then there these they this those through too under until very was were what when ' +
    'where which while who why will with would you your why please help need want issue problem error code file class method function ' +
    'return public private static void string true false null import export const let var new this').split(/\s+/),
);

export const codeLike = (word: string): boolean => /[a-z][A-Z]|_|\d/.test(word) || /^[A-Z][a-z]+[A-Z]/.test(word);

/** DDL, ORM mapping, or a SELECT…FROM that could ground "how does this apply to our DB?". */
export function hasSchemaEvidence(text: string): boolean {
  return (
    /\b(?:CREATE\s+TABLE|ALTER\s+TABLE|PRIMARY\s+KEY|FOREIGN\s+KEY|JOIN\s+[\w."]+|REFERENCES\s+[\w."]+|UNIQUE\s*\(|CHECK\s*\(|@Entity\b|@Table\b|@Column\b|liquibase|flyway|schema\.sql)\b/i.test(
      text,
    ) || /\bSELECT\b[\s\S]{0,800}\bFROM\b/i.test(text)
  );
}

/** Question/excerpt looks like conceptual relational theory (normal forms, etc.) without executable schema in the same blob. */
export function isConceptualDbTheoryQuestion(text: string): boolean {
  return (
    /\b(?:1NF|2NF|3NF|BCNF|first\s+normal\s+form|second\s+normal\s+form|third\s+normal\s+form|normal\s+forms?|normalization|normalised|normalized)\b/i.test(text) ||
    /\bwhat\s+is\s+(?:a\s+)?(?:database\s+)?(?:relation|tuple|attribute|candidate\s+key|primary\s+key)\b/i.test(text)
  );
}

/** True when the anchored material is theory-only — Learn deep sections and repo search should not pretend there is application code. */
export function conceptualDbTheoryWithoutSchema(ctx: { selection: string; surrounding: string }): boolean {
  const blob = `${ctx.selection}\n${ctx.surrounding}`.slice(0, 4000);
  return isConceptualDbTheoryQuestion(blob) && !hasSchemaEvidence(blob);
}

/** Inline code in the engineer's message (backticks), not the editor selection. */
export function hasInlineCodeInQuestion(question: string): boolean {
  return /`[^`\n]{2,}`/.test(question) || /```[\s\S]+?```/.test(question);
}

/** Questions about the anchored snippet itself, not "where is symbol X in the repo?". */
export function isConceptualSnippetQuestion(question: string): boolean {
  return (
    /\bwhy\s+is\s+it\s+important\b/i.test(question) ||
    /\bwhat\s+does\s+this\b/i.test(question) ||
    /\bwhat\s+does\s+that\b/i.test(question) ||
    /\bwhy\s+(?:do\s+we\s+|does\s+this\s+)?(?:use|set|return|assign|pass)\b/i.test(question) ||
    /\bexplain\s+this\b/i.test(question) ||
    /\bhow\s+does\s+this\s+work\b/i.test(question) ||
    /\bwhat\s+is\s+the\s+(?:point|purpose)\b/i.test(question) ||
    /\bin\s+this\s+(?:code|snippet|case|reducer|function|block|pattern)\b/i.test(question)
  );
}

/** Non-trivial editor selection or pasted excerpt — enough to answer without grepping productId across the repo. */
export function hasAnchoredCodeExcerpt(code: string): boolean {
  const trimmed = code.trim();
  if (trimmed.length < 20) return false;
  return /[{;=]|=>|\b(?:return|const|let|function|class|interface)\b/.test(trimmed);
}

/** True when repo grep would add noise (theory-only DB questions, or conceptual questions about an anchored snippet). */
export function skipRepoSearchForAnswer(question: string, code: string): boolean {
  if (isConceptualDbTheoryQuestion(question) && !hasSchemaEvidence(code)) return true;
  if (isConceptualSnippetQuestion(question) && (hasInlineCodeInQuestion(question) || hasAnchoredCodeExcerpt(code))) return true;
  return false;
}

/** Identifier-like words from the question and the selected code, code-shaped names first. */
export function searchTerms(...texts: string[]): string[] {
  const weights = new Map<string, number>();
  for (const text of texts) {
    for (const match of text.matchAll(/[A-Za-z_][A-Za-z0-9_]{3,}/g)) {
      const word = match[0];
      if (STOP.has(word.toLowerCase())) continue;
      const weight = codeLike(word) ? 3 : /^[A-Z]/.test(word) ? 2 : 1;
      weights.set(word, Math.max(weights.get(word) ?? 0, weight));
    }
  }
  const ranked = [...weights.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  // With two or more identifiers, plain and capitalised words (Optional, Workday, Every) only add noise.
  const strong = ranked.filter(([, weight]) => weight === 3);
  return (strong.length >= 2 ? strong : ranked).slice(0, 8).map(([word]) => word);
}

export function grepFiles(files: readonly SearchFile[], terms: readonly string[], options: { maxHits?: number; context?: number } = {}): SearchHit[] {
  const maxHits = options.maxHits ?? 8;
  const context = options.context ?? 2;
  const lowered = terms.map((term) => ({ term: term.toLowerCase(), weight: codeLike(term) ? 3 : 1 }));
  if (lowered.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const file of files) {
    const lines = file.text.split('\n');
    const path = file.path.toLowerCase();
    const pathBonus = lowered.some(({ term }) => path.includes(term)) ? 2 : 0;
    lines.forEach((raw, index) => {
      const line = raw.toLowerCase();
      const matched = lowered.filter(({ term }) => line.includes(term));
      const score = matched.reduce((sum, { weight }) => sum + weight, 0);
      // One plain English word on its own is too noisy to be evidence.
      if (score < 2) return;
      hits.push({
        file: file.path,
        line: index + 1,
        score: score + pathBonus,
        snippet: lines.slice(Math.max(0, index - context), index + context + 1).join('\n').slice(0, 500),
      });
    });
  }
  hits.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);
  const kept: SearchHit[] = [];
  for (const hit of hits) {
    if (kept.some((other) => other.file === hit.file && Math.abs(other.line - hit.line) <= 3)) continue;
    kept.push(hit);
    if (kept.length >= maxHits) break;
  }
  return kept;
}

export function mergeHits(first: readonly SearchHit[], second: readonly SearchHit[], max = 10): SearchHit[] {
  const merged = [...first];
  for (const hit of second) {
    if (!merged.some((other) => other.file === hit.file && Math.abs(other.line - hit.line) <= 3)) merged.push(hit);
  }
  return merged.sort((a, b) => b.score - a.score).slice(0, max);
}

export function formatHits(hits: readonly SearchHit[]): string {
  if (hits.length === 0) return 'No matching lines were found in the repository.';
  return hits.map((hit) => `${hit.file}:${hit.line}\n${hit.snippet}`).join('\n---\n');
}

export interface TermFact {
  term: string;
  files: string[];
  lines: number;
}

/** Counted, not inferred: where each identifier really appears, so the model cannot invent usages. */
export function termFacts(files: readonly SearchFile[], terms: readonly string[], max = 4): TermFact[] {
  return terms.filter(codeLike).slice(0, max).map((term) => {
    const where: string[] = [];
    let lines = 0;
    for (const file of files) {
      const count = file.text.split('\n').filter((line) => line.includes(term)).length;
      if (count > 0) { where.push(file.path); lines += count; }
    }
    return { term, files: where.slice(0, 6), lines };
  });
}

export function formatFacts(facts: readonly TermFact[]): string {
  if (facts.length === 0) return '';
  return facts.map((fact) => fact.files.length
    ? `${fact.term}: ${fact.lines} line(s) in ${fact.files.length} file(s): ${fact.files.join(', ')}`
    : `${fact.term}: not found anywhere in the searched files`).join('\n');
}

/** SQL names rarely appear in Java or TypeScript as written, so also search the class and field spelling: partner_status -> PartnerStatus. */
export function expandTerms(terms: readonly string[], max = 14): string[] {
  const out = [...terms];
  for (const term of terms) {
    if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(term)) continue;
    const pascal = term.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
    if (!out.some((other) => other.toLowerCase() === pascal.toLowerCase())) out.push(pascal);
  }
  return out.slice(0, max);
}

/** Upper-case words in quotes, such as status values: 'ACTIVE', "CERTIFICATES_UPLOADED". */
export function stringConstants(code: string, max = 12): string[] {
  return unique([...code.matchAll(/(['"])([A-Z][A-Z0-9_]{2,})\1/g)].map((match) => match[2]!)).slice(0, max);
}

const unique = <T,>(items: T[]): T[] => [...new Set(items)];

export interface ValueSet {
  /** The name the list is declared under (an enum, type or constant), or '' when only a co-occurrence was found. */
  name: string;
  kind: 'enum' | 'union' | 'list' | 'together';
  values: string[];
  file: string;
  line: number;
}

const blankComments = (text: string): string => text
  .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead: string) => lead + ' '.repeat(match.length - lead.length));

function splitTop(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '(' || char === '{') depth += 1;
    else if (char === ')' || char === '}') depth -= 1;
    if (char === ',' && depth === 0) { out.push(current); current = ''; } else current += char;
  }
  out.push(current);
  return out;
}

const isTest = (path: string): boolean => /(^|\/)(__tests__|tests?|e2e)\/|\.(test|spec)\.[jt]sx?$|Test\.java$/.test(path);

/** Declarations that fix a name to a closed list of values: Java/TS enums, TS string unions, const arrays of strings. */
export function closedSets(files: readonly SearchFile[], names: readonly string[], max = 4): ValueSet[] {
  const found: ValueSet[] = [];
  for (const name of unique([...names])) {
    if (!/^[A-Za-z_]\w{2,}$/.test(name)) continue;
    const words = name.match(/[A-Z][a-z0-9]+|[a-z0-9]+/g) ?? [];
    for (const file of files) {
      if (!file.text.toLowerCase().includes(name.toLowerCase())) continue;
      const text = blankComments(file.text);
      const lineAt = (index: number): number => text.slice(0, index).split('\n').length;
      const declared = new RegExp(`\\benum\\s+${name}\\b[^{;]*\\{([^}]*)\\}`).exec(text);
      if (declared) {
        const values = splitTop(declared[1]!.split(';')[0]!)
          .map((item) => item.replace(/@\w+(?:\([^)]*\))?/g, '').replace(/[(=][\s\S]*$/, '').trim())
          .filter((item) => /^[A-Za-z_]\w*$/.test(item));
        if (values.length >= 2) { found.push({ name, kind: 'enum', values, file: file.path, line: lineAt(declared.index) }); continue; }
      }
      const union = new RegExp(`\\btype\\s+${name}\\s*=\\s*((?:\\s*\\|?\\s*(?:'[^'\\n]+'|"[^"\\n]+"))+)`).exec(text);
      if (union) {
        const values = [...union[1]!.matchAll(/['"]([^'"\n]+)['"]/g)].map((match) => match[1]!);
        if (values.length >= 2) found.push({ name, kind: 'union', values, file: file.path, line: lineAt(union.index) });
      }
      if (words.length >= 2) {
        const list = new RegExp(`\\bconst\\s+(\\w*${words.join('_?')}\\w*)\\s*(?::[^=]+)?=\\s*\\[([^\\]]*)\\]`, 'i').exec(text);
        if (list) {
          const values = [...list[2]!.matchAll(/['"]([^'"\n]+)['"]/g)].map((match) => match[1]!);
          if (values.length >= 2) found.push({ name: list[1]!, kind: 'list', values, file: file.path, line: lineAt(list.index) });
        }
      }
    }
  }
  return found.sort((a, b) => Number(isTest(a.file)) - Number(isTest(b.file)) || b.values.length - a.values.length).slice(0, max);
}

/** Files where most of the given constants appear close together: usually the one place a list of allowed values is written. */
export function valueSets(files: readonly SearchFile[], literals: readonly string[], window = 14, max = 3): ValueSet[] {
  if (literals.length < 3) return [];
  const need = Math.min(literals.length, Math.max(3, Math.ceil(literals.length / 2)));
  const patterns = literals.map((literal) => ({ literal, pattern: new RegExp(`(?<![A-Za-z0-9_])${literal}(?![A-Za-z0-9_])`) }));
  const found: ValueSet[] = [];
  for (const file of files) {
    if (!literals.some((literal) => file.text.includes(literal))) continue;
    const marks: { line: number; literal: string }[] = [];
    file.text.split('\n').forEach((text, index) => {
      for (const item of patterns) if (item.pattern.test(text)) marks.push({ line: index + 1, literal: item.literal });
    });
    let best: { line: number; values: string[] } | null = null;
    for (const mark of marks) {
      const values = unique(marks.filter((other) => other.line >= mark.line && other.line < mark.line + window).map((other) => other.literal));
      if (values.length >= need && (!best || values.length > best.values.length)) best = { line: mark.line, values };
    }
    if (best) found.push({ name: '', kind: 'together', values: best.values, file: file.path, line: best.line });
  }
  return found.sort((a, b) => Number(isTest(a.file)) - Number(isTest(b.file)) || b.values.length - a.values.length || a.file.localeCompare(b.file)).slice(0, max);
}
