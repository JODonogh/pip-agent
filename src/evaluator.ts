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
