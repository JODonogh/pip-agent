import type { Concept } from './types';

/**
 * Local memory with simplified conditioning rules (documented as simplified):
 * - Eligibility trace: a cue only counts if it is recent — score decays with age.
 * - Overshadowing: when several concepts match, only the strongest cue is offered.
 * - Blocking / latent inhibition: mastered or endlessly-unreinforced concepts stop surfacing.
 */

const DAY_MS = 86_400_000;

export function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((w) => w.length > 2),
  );
}

export function overlapScore(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) {
    return 0;
  }
  let hit = 0;
  for (const t of ta) {
    if (tb.has(t)) {
      hit += 1;
    }
  }
  return hit / Math.max(ta.size, tb.size);
}

/** Recent, missed-before concepts score highest. Mastered concepts score 0. */
export function hintScore(concept: Concept, query: string, now: number): number {
  if (concept.mastered) {
    return 0; // blocking: association already made, stop cueing it
  }
  const overlap = overlapScore(`${concept.term} ${concept.bottomLine}`, query);
  if (overlap === 0) {
    return 0;
  }
  const ageDays = Math.max(0, (now - concept.lastSeenAt) / DAY_MS);
  const recency = Math.exp(-ageDays / 7); // eligibility trace: ~1 week window
  const weakness = 1 + concept.misses * 0.5; // missed drills strengthen the cue
  return overlap * recency * weakness;
}

/** Overshadowing: return only the single strongest matching cue, if any. */
export function bestHint(concepts: readonly Concept[], query: string, now: number): Concept | null {
  let best: Concept | null = null;
  let bestScore = 0.05; // threshold: weak matches stay silent
  for (const concept of concepts) {
    const score = hintScore(concept, query, now);
    if (score > bestScore) {
      bestScore = score;
      best = concept;
    }
  }
  return best;
}

/** Weak spots first, then newest. Mastered sink to the bottom. */
export function sortForReview(concepts: readonly Concept[]): Concept[] {
  return [...concepts].sort((a, b) => {
    if (a.mastered !== b.mastered) {
      return a.mastered ? 1 : -1;
    }
    if (b.misses !== a.misses) {
      return b.misses - a.misses;
    }
    return b.createdAt - a.createdAt;
  });
}

export function grade(concept: Concept, gotIt: boolean, now: number): Concept {
  const hits = concept.hits + (gotIt ? 1 : 0);
  const misses = concept.misses + (gotIt ? 0 : 1);
  return {
    ...concept,
    hits,
    misses,
    lastSeenAt: now,
    mastered: gotIt && hits >= 2, // two clean recalls = association made
  };
}
