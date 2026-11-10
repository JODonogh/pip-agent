import type { Concept } from '../shared/types';

export interface RetrievalQuestion {
  conceptId: string;
  term: string;
  question: string;
  source: string;
}

export interface DayReview {
  date: string;
  text: string;
  questions: RetrievalQuestion[];
  conceptIds: string[];
  schemaVersion: 2;
}

/** Match the editor's local day; UTC dates misclassify notes around local midnight. */
export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function conceptsForLocalDay(concepts: readonly Concept[], day: string): Concept[] {
  return concepts.filter((concept) => localDateKey(new Date(concept.lastSeenAt || concept.createdAt)) === day);
}

function questionFor(concept: Concept): string {
  const term = concept.term.replace(/`/g, '').replace(/\s+/g, ' ').trim().slice(0, 85);
  const cue = `${concept.term} ${concept.bottomLine}`;
  if (/\bSQL\s+LIKE\b/i.test(cue) || /\bLIKE\b/.test(cue) || /\bsql\b/i.test(cue) && /\bwildcard/i.test(cue)) {
    return `For ${term}, how does escaping % or _ change SQL LIKE matching, and why is SQL parameter binding a separate concern?`;
  }
  if (/sql\s*injection/i.test(cue)) {
    return `For ${term}, what separates query structure from input data, and what evidence would establish that parameters are bound?`;
  }
  if (/\bvi\.mock\b|\bfetch\b.*\b(?:mock|stub)|\b(?:mock|stub)\b.*\bfetch\b/i.test(cue)) {
    return `For ${term}, which boundary is replaced, and what additional evidence would establish that transport is isolated?`;
  }
  if (/^\s*(?:hypothesis|unverified|possible cause|speculation)\b/i.test(concept.bottomLine)) {
    return `For ${term}, what observation would support this hypothesis, and what result would rule it out?`;
  }
  if (/\b(?:async|await|promise|event loop)\b/i.test(cue)) {
    return `For ${term}, when does the asynchronous work start, and what must finish before the caller can use its result?`;
  }
  if (/\b(?:stream|map|filter|reduce|collect|toList)\b/i.test(cue)) {
    return `For ${term}, trace one input through the transformation; what should happen for an empty input or one filtered-out value?`;
  }
  return `For ${term}, what contract does the code promise, and which boundary input would test whether that promise holds?`;
}

/** Retrieval practice asks the engineer to reconstruct ideas; it never repeats kept prose as verified fact. */
export function retrievalQuestions(concepts: readonly Concept[], limit = 3): RetrievalQuestion[] {
  if (limit <= 0) return [];
  const seen = new Set<string>();
  const ordered = [...concepts].sort((a, b) => (b.misses - b.hits) - (a.misses - a.hits) || b.lastSeenAt - a.lastSeenAt);
  const questions: RetrievalQuestion[] = [];
  for (const concept of ordered) {
    const term = concept.term.replace(/\s+/g, ' ').trim();
    const key = `${term.toLowerCase()}|${concept.file}`;
    if (!term || seen.has(key)) continue;
    seen.add(key);
    questions.push({ conceptId: concept.id, term, question: questionFor(concept), source: `${concept.file}:${concept.line}` });
    if (questions.length >= Math.min(3, Math.max(0, limit))) break;
  }
  return questions;
}

export function buildDayReview(concepts: readonly Concept[], date = localDateKey()): DayReview {
  const questions = retrievalQuestions(concepts);
  return { date, questions, conceptIds: questions.map((question) => question.conceptId),
    text: questions.map((question) => question.question).join('\n'), schemaVersion: 2 };
}

/** Legacy summaries remain in storage but are never replayed as trusted prose or hints. */
export function safeReviewCard(
  saved: { date: string; text: string; conceptIds?: readonly string[]; schemaVersion?: number } | null,
  concepts: readonly Concept[],
): DayReview | null {
  if (!saved || !/^\d{4}-\d{2}-\d{2}$/.test(saved.date)) return null;
  const pool = Array.isArray(saved.conceptIds)
    ? concepts.filter((concept) => saved.conceptIds!.includes(concept.id))
    : saved.schemaVersion === 2 ? [] : conceptsForLocalDay(concepts, saved.date);
  const review = buildDayReview(pool, saved.date);
  return review.questions.length ? review : null;
}
