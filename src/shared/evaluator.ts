import { logEvaluatorDiagnostic } from '../platform/diagnostics';
import type { CodeContext, Explanation } from './types';

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

  let inCodeFence = false;
  for (const line of lines) {
    const rawTrimmed = line.trim();
    if (/^```/.test(rawTrimmed)) { inCodeFence = !inCodeFence; repaired = true; continue; }
    if (inCodeFence) continue;
    const trimmed = rawTrimmed.replace(/^#+\s*/, '');
    if (trimmed.startsWith('BOTTOM_LINE:')) {
      bottomLine = trimmed.replace('BOTTOM_LINE:', '').trim();
    } else if (rawTrimmed.startsWith('###')) {
      flush();
      current = { title: trimmed, body: [] };
    } else if (trimmed && current) {
      current.body.push(trimmed);
    } else if (trimmed && !bottomLine) {
      bottomLine = trimmed;
      repaired = true;
    }
  }
  flush();

  if (!bottomLine) {
    logEvaluatorDiagnostic(
      'evaluateExplanation',
      'Missing BOTTOM_LINE in model output; placeholder applied',
      raw.slice(0, 400).replace(/\s+/g, ' '),
    );
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
      const clipped = words.slice(0, CHUNK_WORD_CAP).join(' ');
      const end = [...clipped.matchAll(/[.!?](?=\s|$)/g)].at(-1)?.index;
      return { title: chunk.title, body: end !== undefined && end > clipped.length / 2 ? clipped.slice(0, end + 1) : `${clipped.replace(/`/g, '')}…` };
    }
    return chunk;
  });
  if (chunks.length > 5) {
    repaired = true;
  }
  return { bottomLine, chunks: capped, repaired };
}

export interface AiLabCard {
  concept: string;
  analogy: string;
  knowledgeCheck: string;
  wherePip: string;
  /** Legacy 15-minute experiment section from older prompts. */
  experiment: string;
}

const CURRICULUM_FACET_IDS = new Set(['history', 'architecture', 'architectures', 'learning', 'inference', 'alignment', 'all']);

/** Webview facet filters must map to a known curriculum track (incl. legacy `architectures`). */
export function normalizeCurriculumFacet(raw: string): string {
  const id = raw.trim().toLowerCase();
  if (id === 'architectures') return 'architecture';
  return CURRICULUM_FACET_IDS.has(id) ? id : 'all';
}

/** Remove chain-of-thought wrappers so DeepSeek-R1 style output fits the 3-part card. */
export function stripModelThinking(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/redacted_thinking>/gi, '')
    .replace(/[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .trim();
}

/** Parse the AI Lab micro-card contract (4-part Brilliant/Duolingo or legacy 3-part). */
export function parseAiLabCard(raw: string): AiLabCard {
  const text = stripModelThinking(raw);
  const result: AiLabCard = { concept: '', analogy: '', knowledgeCheck: '', wherePip: '', experiment: '' };
  const sections: Array<{ key: keyof AiLabCard; marker: RegExp }> = [
    { key: 'concept', marker: /^#{1,3}\s*(?:💡\s*)?The Big Idea/i },
    { key: 'analogy', marker: /^#{1,3}\s*(?:🔍\s*)?Everyday Analogy/i },
    { key: 'knowledgeCheck', marker: /^#{1,3}\s*(?:🎯\s*)?Quick Knowledge Check/i },
    { key: 'wherePip', marker: /^#{1,3}\s*(?:🛠️?\s*)?PIP Connection/i },
    { key: 'concept', marker: /^#{1,3}\s*1\.\s*The AI Concept/i },
    { key: 'wherePip', marker: /^#{1,3}\s*2\.\s*How PIP/i },
    { key: 'experiment', marker: /^#{1,3}\s*3\.\s*15-Minute/i },
  ];
  const bodies: Record<keyof AiLabCard, string[]> = {
    concept: [],
    analogy: [],
    knowledgeCheck: [],
    wherePip: [],
    experiment: [],
  };
  let current: keyof AiLabCard | null = null;
  let inFence = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      if (current) bodies[current].push(line);
      continue;
    }
    if (!inFence) {
      const hit = sections.find((section) => section.marker.test(trimmed));
      if (hit) {
        current = hit.key;
        continue;
      }
    }
    if (current) bodies[current].push(line);
  }
  for (const key of Object.keys(result) as Array<keyof AiLabCard>) {
    result[key] = bodies[key].join('\n').trim();
  }
  if (!result.concept && !result.analogy && !result.knowledgeCheck && !result.wherePip && !result.experiment && text) {
    result.concept = text;
  }
  return result;
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

/** Keep confirmation/correction intact; allow at most one follow-up question. */
export function evaluateDuck(raw: string): { text: string; repaired: boolean } {
  const flat = raw.trim();
  const questions = countQuestions(flat);
  if (questions <= 1) {
    return { text: flat, repaired: false };
  }
  let keptQuestion = false;
  const text = flat.replace(/[^.!?\n]*\?/g, (question) => {
    if (keptQuestion) return '';
    keptQuestion = true;
    return question;
  }).replace(/\n{2,}/g, '\n').trim();
  return { text, repaired: true };
}

/**
 * Blocklist of macOS Eloquence (1990s formant synthesizer) and novelty voices.
 * These are the voices that sound robotic ("Flo", "Eddy", "Reed", "Rocko", etc.).
 */
const ROBOTIC_VOICE_PATTERN =
  /\b(flo|eddy|reed|rocko|sandy|shelley|grandma|grandpa|fred|ralph|albert|kathy|junior|zarvox|trinoids|whisper|bells|boing|bubbles|cellos|organ|bad news|good news|bahh|wobble|jester|superstar)\b/i;

/**
 * Filter `say -v '?'` lines down to natural human-recorded English voices only,
 * ranked with Premium/Enhanced/Siri first, then Daniel (UK) & Moira (IE).
 */
export function filterNaturalVoices(rawLines: readonly string[]): string[] {
  const seen = new Set<string>();
  const candidates: { name: string; score: number }[] = [];

  for (const rawLine of rawLines) {
    const match = /^(.+?)\s+(en[_-][A-Za-z]{2})\s+#\s*(.*)$/.exec(rawLine.trim());
    if (!match) continue;
    const name = (match[1] ?? '').trim();
    const locale = (match[2] ?? '').trim();
    const sample = (match[3] ?? '').trim();
    if (!name || ROBOTIC_VOICE_PATTERN.test(name) || seen.has(name)) {
      continue;
    }
    seen.add(name);
    const lower = `${name} ${locale} ${sample}`.toLowerCase();
    let score = 10;
    if (lower.includes('premium') || lower.includes('natural') || lower.includes('neural')) score += 50;
    if (lower.includes('enhanced')) score += 40;
    if (lower.includes('siri')) score += 35;
    if (/\bdaniel\b/i.test(name)) score += 30;
    if (/\bmoira\b/i.test(name)) score += 28;
    if (/\bkaren\b/i.test(name)) score += 24;
    if (/\btessa\b|\btara\b|\baman\b/i.test(name)) score += 20;
    if (/\bsamantha\b/i.test(name)) score += 15;
    candidates.push({ name, score });
  }

  return candidates.sort((a, b) => b.score - a.score).map((c) => c.name);
}

export interface SpeakChoice {
  id: string;
  label: string;
}

/**
 * Premium / enhanced macOS voices only when any exist.
 * Compact voices (Daniel, Moira, Samantha, …) and Eloquence stay out of the list
 * once a premium voice is installed — those are the ones that sound robotic.
 */
export function preferredSpeakVoices(rows: readonly { id: string; name: string }[]): SpeakChoice[] {
  const robotic =
    /eloquence|flo|eddy|reed|rocko|sandy|shelley|grandma|grandpa|zarvox|trinoids|whisper|bells|boing|bubbles|cellos|organ|bad news|good news|bahh|wobble|jester|superstar|albert|fred|ralph|kathy|junior/i;
  const usable = rows.filter((row) => row.id && row.name && !robotic.test(row.id) && !robotic.test(row.name));
  const premium = usable.filter((row) => /premium|enhanced/i.test(row.id));
  const pool = premium.length > 0 ? premium : usable.filter((row) => !/\.compact\./i.test(row.id));
  const ranked = pool
    .map((row) => {
      let score = 0;
      if (/premium/i.test(row.id)) score += 50;
      if (/enhanced/i.test(row.id)) score += 40;
      if (/\btara\b/i.test(row.name)) score += 20;
      if (/\baman\b/i.test(row.name)) score += 18;
      if (/en-GB|en_GB/i.test(row.id)) score += 6;
      const short = row.name.replace(/\s*\(.*\)\s*$/, '').trim();
      const label = /premium|enhanced/i.test(row.id) ? `${short} · premium` : short;
      return { id: row.id, label, score };
    })
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  const seen = new Set<string>();
  const choices: SpeakChoice[] = [];
  for (const row of ranked) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    choices.push({ id: row.id, label: row.label });
  }
  return choices;
}

/** Strip markdown backticks, bold/italic markers, and code arrows so TTS reads naturally. */
export function cleanSpeechText(raw: string): string {
  return raw
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/[_#]+/g, ' ')
    .replace(/->|=>|→/g, ' to ')
    .replace(/\s+/g, ' ')
    .trim();
}

const HISTORY_MARK =
  /\b(1[5-9]\d{2}|20[0-2]\d)\b|\b(mccarthy|hoare|parnas|abramov|alpert|markb[aå]ge|turing|dijkstra|liskov|goodenough|fielding|b[oö]hm|jacopini|clark)\b/i;

const CODE_BLURB =
  /\b(this (code|snippet|component|function|selection)|provides users|adjusts its content|actionable interface)\b/i;

/** True when the text is a historical origin, not a description of what the code does. */
export function looksLikeHistory(text: string): boolean {
  return HISTORY_MARK.test(text) && !CODE_BLURB.test(text);
}

interface RootStory {
  test: RegExp;
  bottomLine: string;
  chunks: Explanation['chunks'];
}

const ROOT_STORIES: readonly RootStory[] = [
  {
    test: /\bEXISTS\s*\(\s*SELECT/i,
    bottomLine: 'EXISTS is the logician’s “there is at least one”, brought into databases by Codd’s relational calculus in 1972.',
    chunks: [
      { title: 'The problem', body: 'Early database programs walked records one by one. Asking “does this partner have any certificate?” meant writing the loop yourself.' },
      { title: 'Codd, 1972', body: 'Edgar Codd showed that a query could be a logical statement using the existential quantifier (∃), leaving the database to decide how to find the rows.' },
      { title: 'The link', body: 'EXISTS (SELECT 1 …) in this query is that ∃: it asks only whether a matching row exists, not what it contains.' },
    ],
    },
  {
    test: /\bIS\s+(?:NOT\s+)?NULL\b/i,
    bottomLine: 'SQL’s NULL means “value unknown”, an idea Codd added to the relational model in 1979, which is why IS NULL exists at all.',
    chunks: [
      { title: 'The problem', body: 'Real records have gaps. A partner may have no deletion date. Storing 0 or an empty string pretends the gap is a value.' },
      { title: 'Codd, 1979', body: 'Codd proposed a mark for missing information. Comparing with it gives “unknown”, so SQL uses three-valued logic, and = NULL never matches.' },
      { title: 'The link', body: 'deleted_at IS NULL asks whether the mark is present, the only test that works for a missing value.' },
    ],
    },
  {
    test: /\bSELECT\b[\s\S]*\bFROM\b/i,
    bottomLine: 'Describing the rows you want instead of how to fetch them comes from Codd’s 1970 relational model and IBM’s SEQUEL, 1974.',
    chunks: [
      { title: 'The problem', body: 'Before 1970 programs navigated pointers between records, so changing how data was stored broke every program.' },
      { title: 'Codd, 1970; Chamberlin and Boyce, 1974', body: 'Codd proposed tables of rows and a declarative language over them. Donald Chamberlin and Raymond Boyce at IBM turned it into SEQUEL, later renamed SQL.' },
      { title: 'The link', body: 'SELECT … FROM … WHERE here states which partners qualify; the database planner decides how to find them.' },
    ],
    },
  {
    test: /\buse(State|Effect|Memo|Callback|Ref|Reducer)\b/,
    bottomLine:
      'React Hooks began as a 2018 proposal by Sophie Alpert, Sebastian Markbåge, and Andrew Clark, so a function could remember state without a class.',
    chunks: [
      {
        title: 'The class problem',
        body: 'Before hooks, state lived on class components and this had to be bound by hand. Function components could not remember anything between renders.',
      },
      {
        title: 'React Conf, October 2018',
        body: 'Dan Abramov showed the Hooks RFC on stage. useState is the cell that replaced this.state: a value, and a function that sets the next one.',
      },
      {
        title: 'The link',
        body: 'The value-and-setter pair in this selection is that 2018 design. It is not an idea invented for this file.',
      },
    ],
  },
  {
    test: /\b(try|catch|throw)\b/,
    bottomLine:
      'Exceptions — a function aborting instead of returning an error code — were set out by John Goodenough in 1975.',
    chunks: [
      {
        title: 'Status codes',
        body: 'Before exceptions, every caller checked a status after every call, and the real work was buried under the checks.',
      },
      {
        title: 'Goodenough, 1975',
        body: 'His paper, and Barbara Liskov’s CLU, made failure a separate path so the normal path could stay straight.',
      },
      {
        title: 'The link',
        body: 'try and catch here are that split: the happy path reads top to bottom, and the failure is handled off to the side.',
      },
    ],
  },
  {
    test: /@(Get|Post|Put|Delete|Patch|Request)Mapping/,
    bottomLine:
      'Mapping a URL and a verb onto a function is REST, which Roy Fielding defined in his 2000 dissertation as resources acted on with a small set of verbs.',
    chunks: [
      {
        title: 'Before REST',
        body: 'Remote calls were often one opaque procedure name. The URL did not say what resource you were touching or what the verb meant.',
      },
      {
        title: 'Fielding, 2000',
        body: 'His dissertation said the web already had the model: a resource, a uniform verb such as GET, and a representation in the response.',
      },
      {
        title: 'The link',
        body: 'The mapping annotation is that contract: this function is what GET (or the other verb) means for one resource.',
      },
    ],
  },
  {
    test: /\.map\s*\(/,
    bottomLine:
      'Applying one function to every item in a list is Lisp’s mapcar, which John McCarthy described in 1960 so the loop itself did not have to be rewritten.',
    chunks: [
      {
        title: 'The handwritten loop',
        body: 'Before map, each list walk named its own index and its own assignment. The repetition was copied, and the interesting part was hard to see.',
      },
      {
        title: 'McCarthy, 1960',
        body: 'mapcar was one of the first higher-order functions: you pass the work for a single element, and the language keeps the traversal.',
      },
      {
        title: 'The link',
        body: 'The .map in this selection is that idea. The function describes one item. map does the repetition.',
      },
    ],
  },
  {
    test: /\bnull\b/,
    bottomLine:
      'null, a value that means there is no object here, was added by Tony Hoare in 1965 — a choice he later called his billion-dollar mistake.',
    chunks: [
      {
        title: 'ALGOL W, 1965',
        body: 'Hoare added null because it was easy to implement. A reference could point at nothing, and the type system would not say so.',
      },
      {
        title: 'The mistake',
        body: 'A null has no fields. Any use without a check crashes. He spent decades warning that the convenience was not worth the crashes.',
      },
      {
        title: 'The link',
        body: 'A null in this selection is that same sentinel: nothing to show, or nothing found. It is cheap, and easy to forget to check.',
      },
    ],
  },
  {
    test: /^\s*import\s/m,
    bottomLine:
      'Importing a surface and hiding the rest is information hiding, which David Parnas argued for in 1972. JavaScript made that boundary syntax in ES2015.',
    chunks: [
      {
        title: 'Parnas, 1972',
        body: 'He argued a module should hide a design decision. Callers depend on the surface, not on how the decision was made inside.',
      },
      {
        title: 'ES2015 modules',
        body: 'import and export turned that boundary into language syntax, after years of ad-hoc patterns such as CommonJS require.',
      },
      {
        title: 'The link',
        body: 'Each import here is a surface this file is allowed to see. The rest of that module stays behind the boundary Parnas described.',
      },
    ],
  },
  {
    test: /\b(async|await|Promise)\b/,
    bottomLine:
      'async/await, which lets asynchronous code read top to bottom, shipped in C# in 2012 and in JavaScript as ES2017, on top of promises from the 1970s.',
    chunks: [
      {
        title: 'Promises',
        body: 'A promise is a value that is not ready yet. The idea shows up in the 1970s, long before the JavaScript syntax.',
      },
      {
        title: '2012 and 2017',
        body: 'C# added async/await in 2012 so the waiting could be written as a straight sequence. JavaScript followed in ES2017.',
      },
      {
        title: 'The link',
        body: 'await here is that pause: the next line runs when the promised value arrives, without a nested callback.',
      },
    ],
  },
  {
    test: /\bif\s*\(/,
    bottomLine:
      'A conditional branch — do this or that — is as old as stored-program machines. Fortran’s IF, in 1957, made it ordinary in a programming language.',
    chunks: [
      {
        title: 'The fork',
        body: 'The machine either continues or jumps. Every later language kept that fork, because a program that cannot choose cannot respond.',
      },
      {
        title: 'Fortran, 1957',
        body: 'IF was one of the first ways a high-level language could choose a path without the programmer writing the jump address.',
      },
      {
        title: 'The link',
        body: 'The if in this selection is that fork. It decides which result the rest of the function is allowed to produce.',
      },
    ],
  },
];

const STRUCTURED_ROOT: RootStory = {
  test: /$^/,
  bottomLine:
    'No origin story is tied to this selection; the closest general root is structured programming: steps, a choice and a loop, shown to be enough by Böhm and Jacopini in 1966.',
  chunks: [
    {
      title: 'Goto',
      body: 'Early programs jumped anywhere. A reader could not recover the path without simulating every branch.',
    },
    {
      title: 'Böhm and Jacopini, 1966',
      body: 'Their structure theorem said sequence, selection, and iteration can express any computation. Structured programming followed.',
    },
    {
      title: 'The link',
      body: 'This selection is that pattern: steps in order, and a choice about what happens next. The history is the shape, not the feature name.',
    },
  ],
};

/** A real origin story for the strongest idea in the selection. Never a summary of the code. */
export function rootsForSelection(code: string): Explanation {
  const story = ROOT_STORIES.find((candidate) => candidate.test.test(code)) ?? STRUCTURED_ROOT;
  return { bottomLine: story.bottomLine, chunks: story.chunks, repaired: false };
}

export interface ImprovementIdea {
  title: string;
  category: string;
  why: string;
  change: string;
  effort: string;
}

/** Parse structured codebase improvement cards. */
export function parseImprovements(raw: string): ImprovementIdea[] {
  const ideas: ImprovementIdea[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim().replace(/^[-*\d.)\s]+/, '');
    if (!trimmed.toUpperCase().startsWith('IMPROVE:')) continue;
    const body = trimmed.slice('IMPROVE:'.length).trim();
    const parts = body.split('|').map((p) => p.trim());
    if (parts.length >= 3) {
      ideas.push({
        category: parts[0] || 'Architecture',
        title: parts[1] || 'Improvement',
        why: parts[2] || '',
        change: parts[3] || parts[2] || '',
        effort: parts[4] || 'S · High impact',
      });
    } else if (body) {
      ideas.push({
        category: 'Codebase',
        title: body.split('—')[0]?.trim() || 'Improvement',
        why: body,
        change: body,
        effort: 'S · Focused',
      });
    }
  }
  return ideas.slice(0, 4);
}

export interface PocIdea {
  title: string;
  hook: string;
  hypothesis: string;
  slice: string;
  demo: string;
}

/** Parse structured POC ideation cards. */
export function parsePocIdeas(raw: string): PocIdea[] {
  const pocs: PocIdea[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim().replace(/^[-*\d.)\s]+/, '');
    if (!trimmed.toUpperCase().startsWith('POC:')) continue;
    const body = trimmed.slice('POC:'.length).trim();
    const parts = body.split('|').map((p) => p.trim());
    if (parts.length >= 3) {
      pocs.push({
        title: parts[0] || 'POC Concept',
        hook: parts[1] || '',
        hypothesis: parts[2] || '',
        slice: parts[3] || 'Build a 1-file spike with stubbed data first.',
        demo: parts[4] || '2-minute side-by-side comparison.',
      });
    } else if (body) {
      pocs.push({
        title: body.split('—')[0]?.trim() || 'POC Concept',
        hook: body,
        hypothesis: 'Prove the core mechanism works end-to-end on one real case.',
        slice: 'Single vertical slice with deterministic fallback.',
        demo: 'Live interactive walkthrough.',
      });
    }
  }
  return pocs.slice(0, 4);
}

const ANCHOR_SKIP = new Set([
  'const', 'let', 'var', 'function', 'return', 'import', 'from', 'export', 'default',
  'true', 'false', 'null', 'undefined', 'async', 'await', 'public', 'private', 'class',
  'interface', 'type', 'new', 'this', 'else', 'for', 'while', 'switch', 'case', 'try',
  'catch', 'throw', 'static', 'void', 'string', 'number', 'boolean',
]);

/** Identifiers and the file name. Ideas have to mention one of these. */
export function codeAnchors(ctx: CodeContext): string[] {
  const found: string[] = [];
  const push = (raw: string): void => {
    const name = raw.trim();
    if (name.length < 3 || ANCHOR_SKIP.has(name) || found.includes(name)) {
      return;
    }
    found.push(name);
  };
  const base = ctx.file.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') ?? '';
  push(base);
  for (const match of ctx.selection.matchAll(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g)) {
    push(match[0] ?? '');
    if (found.length >= 8) {
      break;
    }
  }
  return found;
}

/** True when the text names a symbol or the file actually under examination. */
export function groundedInCode(text: string, anchors: readonly string[]): boolean {
  const hay = text.toLowerCase();
  return anchors.some((anchor) => anchor.length > 2 && hay.includes(anchor.toLowerCase()));
}

/** Used when the model proposes something that is not in this file. No second model call. */
export function localImprovements(ctx: CodeContext): ImprovementIdea[] {
  const anchors = codeAnchors(ctx);
  const symbol = anchors[1] ?? anchors[0] ?? 'selection';
  const ideas: ImprovementIdea[] = [
    {
      category: 'Architecture',
      title: `Name the decision in ${symbol}`,
      why: `${ctx.file} buries what ${symbol} decides inside the surrounding lines.`,
      change: `Pull that decision into a function in ${ctx.file} and call it from the current place.`,
      effort: 'S · this file only',
    },
  ];
  if (/\bif\s*\(/.test(ctx.selection)) {
    ideas.unshift({
      category: 'DX & Testing',
      title: `Test both sides of ${symbol}`,
      why: `${ctx.file} branches, and one side of ${symbol} is easy to leave untested.`,
      change: `Add two cases in a test for ${ctx.file}: one for each side of ${symbol}.`,
      effort: 'XS · this file only',
    });
  }
  return ideas.slice(0, 2);
}

/** A POC that changes this file, not a product in another domain. */
export function localPocs(ctx: CodeContext): PocIdea[] {
  const anchors = codeAnchors(ctx);
  const symbol = anchors[1] ?? anchors[0] ?? 'selection';
  return [
    {
      title: `Spike on ${symbol}`,
      hook: `One file, ${ctx.file}. Change only ${symbol}.`,
      hypothesis: `A smaller ${symbol} in ${ctx.file} is enough to show the behavior.`,
      slice: `Hard-code one input, call ${symbol}, and print the result. No new service.`,
      demo: `Run ${ctx.file} on that input and show before and after.`,
    },
  ];
}
