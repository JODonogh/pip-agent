import type { Concept } from '../shared/types';

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

export type Rung = 'basic' | 'working' | 'complex';

const RUNG_RANK: Record<Rung, number> = { basic: 0, working: 1, complex: 2 };

/** What they already hold. Three exposures, or two clean recalls, is the complex rung. */
export function rungOf(concept: Concept): Rung {
  const exposures = concept.exposures ?? 1;
  if (concept.mastered || concept.hits >= 2 || exposures >= 3) {
    return 'complex';
  }
  if (concept.hits >= 1 || exposures >= 2) {
    return 'working';
  }
  return 'basic';
}

export function conceptTerm(selection: string, focus?: string): string {
  const clicked = focus?.trim();
  if (clicked) {
    return clicked.slice(0, 80);
  }
  const patterns = [
    /(?:function|class)\s+(\w+)/,
    /(?:const|let|var)\s+(\w+)\s*=/,
    /(?:public|private|protected)\s+(?:static\s+)?(?:[\w<>[\], ?]+)\s+(\w+)\s*\(/,
  ];
  for (const pattern of patterns) {
    const name = pattern.exec(selection)?.[1];
    if (name) {
      return name;
    }
  }
  const rows = selection
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => row.length > 0 && !row.startsWith('import ') && !row.startsWith('//'));
  if (rows[0]?.startsWith('.')) {
    // A call chain such as .stream() then .toList() is one idea, not just its first line.
    const chain: string[] = [];
    for (const row of rows) {
      if (!row.startsWith('.')) {
        break;
      }
      chain.push(row);
    }
    return chain.join('').replace(/^\./, '').replace(/;+\s*$/, '').replace(/\s+/g, ' ').slice(0, 80);
  }
  // No placeholder title: an empty term lets the caller refuse to save a card with nothing on it.
  return (rows[0] ?? '').replace(/\s+/g, ' ').slice(0, 80);
}

/** Share of the concept's own words that show up in the code being read. */
function conceptRecall(conceptText: string, query: string): number {
  const cue = tokens(conceptText);
  const doc = tokens(query);
  if (cue.size === 0 || doc.size === 0) {
    return 0;
  }
  let hit = 0;
  for (const token of cue) {
    if (doc.has(token)) {
      hit += 1;
    }
  }
  return hit / cue.size;
}

export interface PriorLearning {
  term: string;
  bottomLine: string;
  file: string;
  rung: Rung;
  mastered: boolean;
}

export interface LearningBrief {
  known: PriorLearning[];
  nextRung: Rung;
  /** One line the panel can show, whether or not the model mentions the store. */
  reference: string;
}

function mentions(concept: Concept, selection: string, file: string): boolean {
  const hay = `${selection}\n${file}`.toLowerCase();
  if (concept.term.trim().length > 1 && hay.includes(concept.term.trim().toLowerCase())) {
    return true;
  }
  return conceptRecall(`${concept.term} ${concept.bottomLine}`, selection) >= 0.34;
}

/**
 * What this engineer already learned that touches the current selection.
 * Mastered notes stay in the brief so the next lesson can build on them.
 */
export function learningBrief(concepts: readonly Concept[], selection: string, file: string): LearningBrief {
  const known = concepts
    .filter((concept) => mentions(concept, selection, file))
    .sort((a, b) => RUNG_RANK[rungOf(b)] - RUNG_RANK[rungOf(a)] || b.lastSeenAt - a.lastSeenAt)
    .slice(0, 5)
    .map((concept) => ({
      term: concept.term,
      bottomLine: concept.bottomLine,
      file: concept.file,
      rung: rungOf(concept),
      mastered: concept.mastered,
    }));

  if (known.length === 0) {
    return {
      known,
      nextRung: 'basic',
      reference: '',
    };
  }

  const highest = known.reduce<Rung>((top, note) => (RUNG_RANK[note.rung] > RUNG_RANK[top] ? note.rung : top), 'basic');
  const nextRung: Rung = highest === 'basic' ? 'working' : 'complex';
  const names = known
    .slice(0, 3)
    .map((note) => `${note.term} (${note.rung})`)
    .join(', ');
  const reference =
    nextRung === 'working'
      ? `Builds on ${names}. You have the basics — this pass is how it works.`
      : `Builds on ${names}. Skipping the definition — this pass is the harder layer.`;
  return { known, nextRung, reference };
}

/** Text injected into explain / deep prompts. */
export function learningPromptBlock(brief: LearningBrief): string {
  if (brief.known.length === 0) {
    return (
      'LEARNING STORE: empty for this code. Teach the BASIC rung only: what this does and the one idea worth keeping. ' +
      'Do not assume prior knowledge.'
    );
  }
  const lines = brief.known
    .map((note) => `- [${note.rung}${note.mastered ? ', mastered' : ''}] ${note.term} (${note.file}): ${note.bottomLine}`)
    .join('\n');
  const rungRule =
    brief.nextRung === 'working'
      ? 'NEXT RUNG: working. They already know the notes above. Do not redefine those terms. ' +
        'Open BOTTOM_LINE by naming the prior term you are extending, then explain the mechanism.'
      : 'NEXT RUNG: complex. They already know the notes above. Do not re-teach definitions. ' +
        'Open BOTTOM_LINE by naming the prior term you are extending, then one edge, cost, or how this sits in the file.';
  return `LEARNING STORE (already learned — reference it and build one step past it):\n${lines}\n${rungRule}`;
}

/** Guarantee the visible bottom line names the stored idea, even if the model ignored it. */
export function referenceBottomLine(bottomLine: string, brief: LearningBrief): string {
  const prior = brief.known[0];
  if (!prior) {
    return bottomLine;
  }
  if (bottomLine.toLowerCase().includes(prior.term.toLowerCase())) {
    return bottomLine;
  }
  return `Building on ${prior.term}: ${bottomLine}`;
}

export interface LearningInput {
  term: string;
  bottomLine: string;
  file: string;
  line: number;
  now: number;
}

/** Update the note for this term in this file, or create it. Exposures only go up. */
export function recordLearning(existing: Concept | undefined, input: LearningInput): Concept {
  return {
    id: existing?.id ?? `${input.term}|${input.file}`,
    learningLayer: existing?.learningLayer,
    term: input.term,
    bottomLine: input.bottomLine || existing?.bottomLine || '',
    file: input.file,
    line: input.line,
    createdAt: existing?.createdAt ?? input.now,
    lastSeenAt: input.now,
    hits: existing?.hits ?? 0,
    misses: existing?.misses ?? 0,
    mastered: existing?.mastered ?? false,
    exposures: (existing?.exposures ?? 0) + 1,
  };
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
