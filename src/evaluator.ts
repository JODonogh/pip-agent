import type { Explanation } from './types';

const CHUNK_WORD_CAP = 60;
export const MAX_DEPTH = 3;

export function countSentences(text: string): number {
  return text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean).length;
}

export function countQuestions(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

/**
 * Deterministic evaluator (no LLM): parses and repairs worker output to the
 * Learn contract — bottom line first, then small pick-and-choose chunks.
 */
export function evaluateExplanation(raw: string): Explanation {
  let repaired = false;
  const lines = raw.split('\n').map((l) => l.trimEnd());
  let bottomLine = '';
  const chunks: Explanation['chunks'] = [];
  let current: { title: string; body: string[] } | null = null;

  const flush = () => {
    if (current) {
      chunks.push({ title: current.title, body: current.body.join(' ').trim() });
      current = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('BOTTOM_LINE:')) {
      bottomLine = trimmed.replace('BOTTOM_LINE:', '').trim();
    } else if (trimmed.startsWith('###')) {
      flush();
      current = { title: trimmed.replace(/^#+\s*/, ''), body: [] };
    } else if (trimmed && current) {
      current.body.push(trimmed);
    } else if (trimmed && !bottomLine) {
      bottomLine = trimmed;
      repaired = true;
    }
  }
  flush();

  if (!bottomLine) {
    bottomLine = 'The model did not lead with a bottom line — open a chunk below.';
    repaired = true;
  }
  if (countSentences(bottomLine) > 1) {
    bottomLine = `${bottomLine.split(/(?<=[.!?])\s/)[0] ?? bottomLine}`;
    repaired = true;
  }

  const capped = chunks.slice(0, 5).map((chunk) => {
    const words = chunk.body.split(/\s+/).filter(Boolean);
    if (words.length > CHUNK_WORD_CAP) {
      repaired = true;
      return { title: chunk.title, body: `${words.slice(0, CHUNK_WORD_CAP).join(' ')} … [cut by evaluator]` };
    }
    return chunk;
  });
  if (chunks.length > 5) {
    repaired = true;
  }
  return { bottomLine, chunks: capped, repaired };
}

/** Quick-fire contract: exactly one sentence out, whatever the model said. */
export function evaluateQuickFire(raw: string): { text: string; repaired: boolean } {
  const flat = raw.replace(/\s+/g, ' ').trim();
  const first = flat.split(/(?<=[.!?])\s/)[0] ?? flat;
  return { text: first, repaired: first !== flat };
}

/** Parse Diverge output into approach cards. */
export function parseApproaches(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.toUpperCase().startsWith('APPROACH:'))
    .map((l) => l.slice('APPROACH:'.length).trim())
    .filter(Boolean)
    .slice(0, 6);
}

export interface Mcq {
  question: string;
  options: string[];
  answerIndex: number;
}

/** Parse a multiple-choice puzzle. Returns null when the model broke the format. */
export function parseMcq(raw: string): Mcq | null {
  const grab = (label: string): string =>
    raw
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith(`${label}:`))
      ?.slice(label.length + 1)
      .trim() ?? '';
  const question = grab('Q');
  const options = ['A', 'B', 'C', 'D'].map(grab);
  const answerLetter = grab('ANSWER').toUpperCase().charAt(0);
  const answerIndex = ['A', 'B', 'C', 'D'].indexOf(answerLetter);
  if (!question || options.some((o) => !o) || answerIndex < 0) {
    return null;
  }
  return { question, options, answerIndex };
}

/** Deterministic cloze: blank the term out of its own bottom line. */
export function makeCloze(concept: { term: string; bottomLine: string }): string {
  const escaped = concept.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return concept.bottomLine.replace(new RegExp(escaped, 'i'), '______');
}

export interface SolverReply {
  restate: string;
  cause: string;
  confidence: string;
  check: string;
  question: string;
}

/** Parse the Solver's 4-part structure; missing parts come back empty, never invented. */
export function parseSolver(raw: string): SolverReply {
  const grab = (label: string): string =>
    raw
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.toUpperCase().startsWith(`${label}:`))
      ?.slice(label.length + 1)
      .trim() ?? '';
  const causeLine = grab('CAUSE');
  const confidence = /confidence:\s*(likely|possible|long shot)/i.exec(causeLine)?.[1]?.toLowerCase() ?? 'possible';
  return {
    restate: grab('RESTATE'),
    cause: causeLine.replace(/\(confidence:[^)]*\)/i, '').trim(),
    confidence,
    check: grab('CHECK'),
    question: grab('QUESTION'),
  };
}

/** First application frame from a Java/JS stack trace — deterministic, no LLM. */
export function firstAppFrame(errorText: string): string {
  for (const line of errorText.split('\n')) {
    const java = /\bat\s+([\w.$]+\([\w.]+:\d+\))/.exec(line);
    if (java && !/^(java\.|jdk\.|sun\.)/.test(java[1] ?? '')) {
      return java[1] ?? '';
    }
    const js = /\bat\s+(.+:\d+:\d+)\)?\s*$/.exec(line.trim());
    if (js && !(js[1] ?? '').includes('node_modules')) {
      return js[1] ?? '';
    }
  }
  return '';
}

export type DrillVerdict = 'CORRECT' | 'PARTLY' | 'WRONG';

/** Parse the drill checker's two-line verdict. Anything unclear counts as PARTLY. */
export function parseDrillVerdict(raw: string): { verdict: DrillVerdict; gap: string } {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const first = (lines[0] ?? '').toUpperCase();
  const verdict: DrillVerdict = first.includes('CORRECT')
    ? 'CORRECT'
    : first.includes('WRONG')
      ? 'WRONG'
      : 'PARTLY';
  return { verdict, gap: lines[1] ?? '' };
}

/** Rubber-duck contract (your /discuss skill): ends with exactly one question. */
export function evaluateDuck(raw: string): { text: string; repaired: boolean } {
  const flat = raw.trim();
  const questions = countQuestions(flat);
  if (questions === 1 && flat.endsWith('?')) {
    return { text: flat, repaired: false };
  }
  const withoutQuestions = flat.replace(/[^.!?\n]*\?/g, '').replace(/\n{2,}/g, '\n').trim();
  return {
    text: `${withoutQuestions}\nWhat is the one thing this must do, in your own words?`,
    repaired: true,
  };
}
