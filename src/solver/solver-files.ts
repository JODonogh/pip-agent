/** File names from model output are hints; only verified workspace candidates may be opened. */
export interface FileReference {
  path: string;
  line?: number;
}

const EXTENSIONS = 'java|tsx?|jsx?|mjs|cjs|py|go|rs|c|cpp|h|hpp|cs|kt|kts|scala|rb|php|swift|vue|svelte|html|css|scss|json|ya?ml|xml|toml|sql|sh|md|gradle|properties';
const FILE_END = `\\.(?:${EXTENSIONS})(?![\\w./\\\\-])(?::\\d+(?::\\d+)?)?`;

function normalisePath(path: string): string {
  const slashes = path.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  return /^[A-Za-z]:\//.test(slashes) ? slashes.toLowerCase() : slashes;
}

function isAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

function parseReference(raw: string): FileReference | null {
  const match = /^(.*?)(?::(\d+)(?::\d+)?)?$/.exec(raw.trim());
  const path = match?.[1]?.trim() ?? '';
  if (!path || /[\x00-\x1f<>|*?#[\]{}]/.test(path) || path.includes('://')) return null;
  if (path.replace(/\\/g, '/').split('/').includes('..')) return null;
  // A drive letter is the only accepted colon in a file path.
  if (path.replace(/^[A-Za-z]:[\\/]/, '').includes(':')) return null;
  if (!new RegExp(`\\.(?:${EXTENSIONS})$`, 'i').test(path)) return null;
  const line = Number(match?.[2]);
  return Number.isSafeInteger(line) && line > 0 ? { path, line } : { path };
}

/** Extract bounded path hints from diagnostics, prose, backticks, and Java stack frames. */
export function extractFileReferences(text: string): FileReference[] {
  const occupied: { start: number; end: number }[] = [];
  // Excluding the whole URL also prevents its tail from becoming a basename hint.
  for (const match of text.matchAll(/\b[a-z][a-z\d+.-]*:\/\/[^\s<>"'`]+/gi)) {
    occupied.push({ start: match.index, end: match.index + match[0].length });
  }
  const refs: FileReference[] = [];
  const add = (raw: string, start: number, end: number): void => {
    if (occupied.some((span) => start < span.end && end > span.start)) return;
    occupied.push({ start, end });
    const reference = parseReference(raw);
    if (!reference) return;
    if (!refs.some((ref) => normalisePath(ref.path) === normalisePath(reference.path) && ref.line === reference.line)) {
      refs.push(reference);
    }
  };

  for (const match of text.matchAll(/[`"]([^`"\n]+)[`"]/g)) {
    add(match[1] ?? '', match.index, match.index + match[0].length);
  }
  // Spaces are accepted inside absolute paths, as in javac diagnostics on macOS.
  const absolute = new RegExp(`(?:^|[^\\w./\\\\:*?#[\\]{}@-])((?:[A-Za-z]:[\\\\/]|/)[^<>"\x60|\\n]*?${FILE_END})`, 'gmi');
  for (const match of text.matchAll(absolute)) {
    const raw = match[1] ?? '';
    const start = match.index + match[0].length - raw.length;
    add(raw, start, start + raw.length);
  }
  const relative = new RegExp(`(?:^|[^\\w./\\\\:*?#[\\]{}@-])([\\w@.-]+(?:[\\\\/][\\w@.-]+)*${FILE_END})`, 'gmi');
  for (const match of text.matchAll(relative)) {
    const raw = match[1] ?? '';
    const start = match.index + match[0].length - raw.length;
    add(raw, start, start + raw.length);
  }
  return refs.slice(0, 30);
}

/** Resolve only a unique exact path or relative suffix; never guess among duplicate basenames. */
export function selectFileMatches(reference: FileReference, candidates: readonly string[]): string[] {
  if (!parseReference(reference.path)) return [];
  const wanted = normalisePath(reference.path).replace(/^\.\//, '');
  const matches = [...new Set(candidates)].filter((candidate) => {
    const path = normalisePath(candidate);
    const target = /^[A-Za-z]:[\\/]/.test(candidate) ? wanted.toLowerCase() : wanted;
    return isAbsolute(reference.path) ? path === target : path.endsWith(`/${target}`);
  });
  return matches.length === 1 ? matches : [];
}
