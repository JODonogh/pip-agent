/** Only key terms become clickable — not every word (your screenshot feedback). */

const STOPWORDS = new Set(
  (
    'the a an and or of to in is are was were be been it its this that these those with for on as at by from ' +
    'when then than so such into over under between through during before after above below each other more ' +
    'most can could should would will shall may might must do does did done have has had having ' +
    'you your we our they their he she his her not no yes if but about which who whom what where why how ' +
    'all any both few many much own same only very just also now here there one two first'
  ).split(' '),
);

/** Transferable technical vocabulary worth clicking, whatever the language. */
const TECH_TERMS = new Set(
  (
    'closure prototype hook hooks state props component render reducer dispatch middleware annotation ' +
    'endpoint request response controller service repository interface implements extends inheritance ' +
    'polymorphism encapsulation abstraction async await promise callback recursion iteration mutation ' +
    'immutable reference value type generic generics exception transaction query index cache stream ' +
    'reduce map filter accumulator dependency injection singleton factory observer decorator payload ' +
    'header body status route routing schema validation serialisation serialization thread concurrency'
  ).split(' '),
);

function normalise(word: string): string {
  return word.replace(/^[^\p{L}\p{N}@]+|[^\p{L}\p{N}]+$/gu, '');
}

/** A word is a keyword if it looks like code, is capitalised mid-sentence, or is technical vocabulary. */
export function isKeyword(rawWord: string, inCodeSpan: boolean): boolean {
  if (inCodeSpan) {
    return true;
  }
  const word = normalise(rawWord);
  if (word.length < 3) {
    return false;
  }
  if (STOPWORDS.has(word.toLowerCase())) {
    return false;
  }
  if (word.startsWith('@')) {
    return true; // @GetMapping, @Transactional
  }
  if (/^[A-Z]{2,}$/.test(word)) {
    return true; // HTTP, GET, API
  }
  if (/[a-z][A-Z]/.test(word) || word.includes('_') || word.endsWith('()')) {
    return true; // camelCase, snake_case, getAll()
  }
  if (/^[A-Z][a-z]+$/.test(word)) {
    return true; // Capitalised terms: Spring, Reduce (also sentence starts — acceptable)
  }
  return TECH_TERMS.has(word.toLowerCase());
}

/** Collect the clickable keyword set for a whole explanation text. */
export function extractKeywords(text: string): string[] {
  const found = new Set<string>();
  const codeSpans = text.match(/`[^`]+`/g) ?? [];
  for (const span of codeSpans) {
    for (const part of span.replace(/`/g, '').split(/[\s.()[\]{}<>,;:=]+/)) {
      const word = normalise(part);
      if (word.length > 2 && !STOPWORDS.has(word.toLowerCase())) {
        found.add(word.toLowerCase());
      }
    }
  }
  const withoutCode = text.replace(/`[^`]+`/g, ' ');
  for (const raw of withoutCode.split(/\s+/)) {
    if (isKeyword(raw, false)) {
      found.add(normalise(raw).toLowerCase());
    }
  }
  return [...found];
}
