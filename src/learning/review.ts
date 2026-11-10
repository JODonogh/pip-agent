import type { Concept, LearningLayer } from '../shared/types';
import { rungOf, type Rung } from './memory';

/**
 * What the Review list shows for one kept idea, worked out here so the webview stays a plain renderer.
 * `rung` stays internal (it sets how deep the next explanation goes); the engineer sees a status and a drill.
 */

export const LEARNING_LAYERS: Record<LearningLayer, { label: string; filterLabel: string; focus: string }> = {
  data: {
    label: 'Data & persistence',
    filterLabel: 'Data & persistence',
    focus: 'Relational modelling, indexes and query plans, transactions, data structures, integrity and consistency.',
  },
  frontend: {
    label: 'UI & human interface',
    filterLabel: 'UI & human interface',
    focus: 'State and asynchronous work, functional transformations, accessible human interfaces, component boundaries and integration tests.',
  },
  backend: {
    label: 'Backend & communication',
    filterLabel: 'Backend & communication',
    focus: 'Object and functional design, concurrency, REST/gRPC contracts, distributed communication, failure handling and integration tests.',
  },
};

/** Which practice layer a piece of text belongs to, judged from its content (SQL in a Java file is still SQL). */
export function inferLayer(text: string): LearningLayer | undefined {
  if (/\bSELECT\b[\s\S]*\bFROM\b|\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b|\bGROUP\s+BY\b|\bLEFT\s+JOIN\b|\bLIKE\b|\bEXISTS\s*\(|\bCAST\s*\(/i.test(text)) return 'data';
  if (/\b(useState|useEffect|useMemo|React|tsx|JSX|Canvas Kit|<\/?div)\b|<\/\w+>/.test(text)) return 'frontend';
  if (/@(Service|Repository|RestController|Controller|Transactional|Entity)\b|\bpublic\s+(class|record|interface)\b|\bSpring\b/.test(text)) return 'backend';
  return undefined;
}

export function layerOf(concept: Concept): LearningLayer | undefined {
  if (concept.learningLayer && concept.learningLayer in LEARNING_LAYERS) return concept.learningLayer;
  const sql = inferLayer(`${concept.term}\n${concept.bottomLine}`);
  if (sql === 'data') return sql;
  if (/\.(sql|prisma)$/i.test(concept.file)) return 'data';
  if (/\.(tsx?|jsx?)$/i.test(concept.file)) return 'frontend';
  if (/\.(java|kt)$/i.test(concept.file)) return 'backend';
  return inferLayer(`${concept.term}\n${concept.bottomLine}`);
}

export function drillFocus(concept: Concept): string {
  const layer = layerOf(concept);
  return layer ? `Practice layer: ${LEARNING_LAYERS[layer].label}. Relevant fundamentals: ${LEARNING_LAYERS[layer].focus} ` : '';
}

export type ReviewStatus = 'new' | 'weak' | 'practising' | 'solid';

export function reviewStatus(concept: Concept): { status: ReviewStatus; label: string; hint: string } {
  if (concept.mastered) {
    return { status: 'solid', label: 'Solid', hint: 'Recalled correctly twice.' };
  }
  if (concept.misses > concept.hits) {
    return { status: 'weak', label: `Needs work ×${concept.misses}`, hint: 'Missed more often than recalled, so it is listed first.' };
  }
  if (concept.hits > 0) {
    return { status: 'practising', label: 'Practising', hint: 'Recalled once. One more clean recall makes it solid.' };
  }
  return { status: 'new', label: 'New', hint: 'Not practised yet.' };
}

const NEXT_LESSON: Record<Rung, string> = {
  basic: 'Next time you explain related code, PIP skips the definition and teaches how it works.',
  working: 'Next time you explain related code, PIP skips the basics and covers edge cases and costs.',
  complex: 'Next time you explain related code, PIP skips the basics and covers edge cases and costs.',
};

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/g;

function bareTerm(term: string): string {
  return term.replace(/^[.@]+/, '').replace(/\(.*$/s, '').trim();
}

/** A fill-in-the-blank built from the takeaway itself. Null when no word is worth hiding. */
export function clozeFor(concept: Concept): { text: string; answer: string } | null {
  const text = concept.bottomLine.trim();
  const words: string[] = text.match(IDENTIFIER) ?? [];
  const term = bareTerm(concept.term).toLowerCase();
  const named = term.length >= 3 ? words.find((word) => word.toLowerCase() === term) : undefined;
  const codeLike = words.filter((word) => word.length >= 4 && /[a-z][A-Z]|_|\d/.test(word));
  const pool = codeLike.length > 0 ? codeLike : words.filter((word) => word.length >= 6);
  const answer = named ?? [...pool].sort((a, b) => b.length - a.length)[0];
  if (!answer) {
    return null;
  }
  return { text: text.replace(new RegExp(`\\b${answer}\\b`), '______'), answer };
}

/** Thirty-second explanation from the kept takeaway — no extra model call. */
export function explainIn30Seconds(concept: Concept): { what: string; why: string } {
  const sentence = concept.bottomLine.split(/(?<=[.!?])\s+/)[0]?.trim() || concept.bottomLine.trim();
  const what = sentence.length > 220 ? `${sentence.slice(0, 217)}…` : sentence;
  const layer = layerOf(concept);
  const why = layer
    ? `Why it matters: ${LEARNING_LAYERS[layer].label} — useful when you explain this area to someone else or before you change related code.`
    : 'Why it matters: you kept this because it will show up again when this area of the codebase changes.';
  return { what, why };
}

export interface ReviewView extends Concept {
  rung: Rung;
  layer?: LearningLayer;
  layerLabel: string;
  explainIn30s: { what: string; why: string };
  status: ReviewStatus;
  statusLabel: string;
  statusHint: string;
  nextLesson: string;
  shortFile: string;
  cloze: { text: string; answer: string } | null;
  /** Only a single name can be guessed from hints; a code fragment cannot. */
  guessable: boolean;
}

export function reviewView(concept: Concept): ReviewView {
  const rung = rungOf(concept);
  const { status, label, hint } = reviewStatus(concept);
  const layer = layerOf(concept);
  return {
    ...concept,
    rung,
    layer,
    layerLabel: layer ? LEARNING_LAYERS[layer].label : 'Choose a layer',
    explainIn30s: explainIn30Seconds(concept),
    status,
    statusLabel: label,
    statusHint: hint,
    nextLesson: NEXT_LESSON[rung],
    shortFile: concept.file.split(/[\\/]/).pop() || concept.file,
    cloze: clozeFor(concept),
    guessable: /^[.@]?[A-Za-z_]\w{2,}(\(\))?$/.test(concept.term.trim()),
  };
}
