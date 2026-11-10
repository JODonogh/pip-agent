/** Prioritise teachable concepts, not capitalisation. Scores are local editorial tiers, not corpus frequencies. */
const COMMON = new Set(('the a an and or of to in is are was were be been it its this that these those with for on as at by from ' +
  'when then than so such into over under between through during before after above below each other more most can could should would will shall may might must do does did done have has had having ' +
  'you your we our they their he she his her not no yes if but about which who whom what where why how all any both few many much own same only very just also now here there one two first ' +
  'sql http https api json xml html css java javascript typescript get post put delete code method function class object string number boolean value input output file test tests data database query table column field row request response service repository controller parameter parameters signature').split(' '));
const OPERATORS = new Set('like ilike coalesce nullif exists having over unnest lateral'.split(' '));
const CONCEPTS = new Set(('closure prototype reducer middleware annotation polymorphism encapsulation abstraction promise callback recursion mutation immutable generics transaction accumulator singleton factory observer decorator schema validation serialization deserialization concurrency memoization idempotency backpressure deadlock livelock reentrancy covariance contravariance collation predicate wildcard wildcards sargability nullability debounce throttle mvcc cqrs csrf xss').split(' '));
const PHRASES = ['type erasure', 'overload resolution', 'short-circuit evaluation', 'short circuit', 'happens-before', 'referential transparency',
  'dependency injection', 'dependency inversion', 'optimistic locking', 'pessimistic locking', 'transaction isolation', 'race condition', 'thread safety',
  'parameter binding', 'bound parameters', 'wildcard escaping', 'pattern matching', 'SQL injection', 'query plan', 'recursive CTE', 'window function',
  'partition by', 'cross join', 'eventual consistency', 'compile-time type', 'dynamic dispatch', 'lazy evaluation', 'fan-out', 'fan-in'];
const normalise = (word: string): string => word.replace(/^[^\p{L}\p{N}@]+|[^\p{L}\p{N}]+$/gu, '');
const fileName = /\b[\w-]+\.(?:java|tsx?|jsx?|py|json|xml|html|css|kt|go|rs|md)\b/gi;

export function isKeyword(rawWord: string, inCodeSpan: boolean): boolean {
  const word = normalise(rawWord), lower = word.toLowerCase();
  if (OPERATORS.has(lower) && (inCodeSpan || word === word.toUpperCase())) return true;
  if (word.length < 3 || COMMON.has(lower)) return false;
  return CONCEPTS.has(lower) || word.startsWith('@') ||
    (inCodeSpan && !word.includes('.')) || /[a-z][A-Z]|_/.test(word);
}

/** Prefer a few specific operators/phrases; explicit code identifiers are lower-priority fallbacks. */
export function extractKeywords(text: string): string[] {
  const candidates = new Map<string, number>();
  const add = (word: string, score: number) => {
    const term = normalise(word).toLowerCase();
    if (term && (!COMMON.has(term) || OPERATORS.has(term))) candidates.set(term, Math.max(score, candidates.get(term) ?? 0));
  };
  const searchable = text.replace(fileName, ' ');
  for (const phrase of PHRASES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(searchable)) add(phrase, 5);
  }
  const codeSpans = searchable.match(/`[^`]+`/g) ?? [];
  const consider = (raw: string, inCode: boolean) => {
    if (!isKeyword(raw, inCode)) return;
    const word = normalise(raw), lower = word.toLowerCase();
    add(word, OPERATORS.has(lower) ? 6 : CONCEPTS.has(lower) ? 4 : word.startsWith('@') ? 3 : 1);
  };
  for (const span of codeSpans) for (const part of span.slice(1, -1).split(/[\s.()[\]{}<>,;:=]+/)) consider(part, true);
  for (const raw of searchable.replace(/`[^`]+`/g, ' ').split(/\s+/)) consider(raw, false);
  return [...candidates].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([term]) => term);
}
