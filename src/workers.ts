import type { ChatMessage, CodeContext, Concept } from './types';

/** One prompt template per worker. The [INTENT:x] tag lets the Mock provider answer deterministically. */

const BASE_RULES = [
  'You are a terse learning aid sitting beside an engineer in their IDE.',
  'Plain language first. One new concept per paragraph. No padding, no history unless asked.',
  'Refer to the given file and line. Use a short analogy only if it genuinely helps.',
].join(' ');

function codeBlock(ctx: CodeContext): string {
  // Trimmed hard: shorter prompts are the cheapest latency win on a local 7B.
  return `File: ${ctx.file}:${ctx.line} (${ctx.language})\n\`\`\`\n${ctx.selection.slice(0, 3000)}\n\`\`\`\nSurrounding context:\n${ctx.surrounding.slice(0, 1200)}`;
}

export type ExplainStyle = 'plain' | 'analogy' | 'foundations';

const STYLE_RULES: Record<ExplainStyle, string> = {
  plain: 'Explain plainly and directly. No analogy unless the code is genuinely confusing without one.',
  analogy:
    'Lead each chunk with a fresh, inventive analogy drawn from everyday life (kitchens, post rooms, ' +
    'railways, sport — surprise me, never the same tired ones), then immediately give the plain truth in ' +
    'the next sentence so the analogy never misleads.',
  foundations:
    'Go structured and theoretical: name the data structure/algorithm at work, its Big O time and ' +
    'space, and the mathematical idea underneath. Still one concept per chunk, still brief.',
};

export function explainPrompt(ctx: CodeContext, focus?: string, style: ExplainStyle = 'plain'): ChatMessage[] {
  const focusLine = focus ? `\nThe engineer clicked on this term and wants it explained: "${focus}"` : '';
  return [
    { role: 'system', content: `${BASE_RULES} ${STYLE_RULES[style]}` },
    {
      role: 'user',
      content:
        `[INTENT:explain]\nExplain this selection so the engineer understands it in under a minute.${focusLine}\n` +
        'Reply in EXACTLY this format:\n' +
        'BOTTOM_LINE: <one sentence>\n' +
        '### <chunk title>\n<at most 50 words>\n' +
        'Use 2-4 chunks. Chunk titles MUST name the actual parts of THIS code (e.g. "The 401 response", ' +
        '"When this fires", "The exception type"). NEVER use generic titles: What it is, How it flows, ' +
        'Worth learning, Watch out, Overview, Summary, Conclusion.\n' +
        codeBlock(ctx),
    },
  ];
}

export function quickFirePrompt(ctx: CodeContext, question: string): ChatMessage[] {
  return [
    { role: 'system', content: BASE_RULES },
    {
      role: 'user',
      content: `[INTENT:quickfire]\nAnswer in EXACTLY one sentence. Question: ${question}\n${codeBlock(ctx)}`,
    },
  ];
}

export function duckPrompt(ctx: CodeContext, statement: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You are a Socratic rubber duck. Reply in about 3 short lines: (1) react plainly — holds, partly holds, or fails, and why; ' +
        '(2) make ONE move: clarify a term, surface an assumption, ask for evidence, give a counterexample, or follow a consequence; ' +
        '(3) end with EXACTLY one question, then stop. Disagree when the reasoning is weak. Never flatter.',
    },
    {
      role: 'user',
      content: `[INTENT:duck]\nThe engineer says: "${statement}"\nAbout this code:\n${codeBlock(ctx)}`,
    },
  ];
}

/** Word-popup: one rapid, succinct line about one term in this code. */
export function popupPrompt(ctx: CodeContext, word: string, question?: string): ChatMessage[] {
  return [
    { role: 'system', content: BASE_RULES },
    {
      role: 'user',
      content:
        `[INTENT:quickfire]\nIn EXACTLY one short sentence, ${question ? `answer "${question}" about` : 'explain'} "${word}" ` +
        `as it is used in this code. No preamble.\n${codeBlock(ctx)}`,
    },
  ];
}

export function drillCheckPrompt(concept: Concept, answer: string): ChatMessage[] {
  return [
    { role: 'system', content: BASE_RULES },
    {
      role: 'user',
      content:
        `[INTENT:drillcheck]\nConcept: "${concept.term}". Correct understanding: "${concept.bottomLine}". ` +
        `The engineer answered: "${answer}". Reply with TWO lines only:\n` +
        'Line 1: CORRECT, PARTLY, or WRONG\n' +
        'Line 2: one sentence naming the gap or confirming the key point.',
    },
  ];
}

/** Deep dives appended under an explanation: foundations, roots/history, pseudocode, trade-offs. */
export function deepPrompt(ctx: CodeContext, kind: string): ChatMessage[] {
  const briefs: Record<string, string> = {
    foundations:
      'Teach the FOUNDATIONS under this code: the data structure or algorithm at work, its Big O ' +
      'time and space with one sentence on why, and the mathematical foundation (algebra/pre-calculus ' +
      'level: recurrence, logarithm, summation — whichever truly applies) with a tiny worked numeric ' +
      'example (e.g. n=8 vs n=1024). End with one chunk on how to recognise this pattern next time.',
    roots:
      'Tell the ROOTS of the key idea in this code as a short story: where it came from (early ' +
      'computing, a mathematician, another field), the problem it originally solved, and one ' +
      'surprising connection to today. Stories, not a timeline dump. 3 chunks maximum.',
    pseudocode:
      'Rewrite the logic of this selection as clean pseudocode, one numbered step per line, no ' +
      'language syntax. Then one chunk naming what the pseudocode makes visible that the code hides.',
  };
  const brief = briefs[kind] ?? `Explain the ${kind} trade-off of THIS code: what it buys, what it costs, and when you would choose differently. Two chunks, concrete to this code, no generic advice.`;
  const isTrade = kind.startsWith('Trade-off');
  return [
    { role: 'system', content: BASE_RULES },
    {
      role: 'user',
      content:
        `[INTENT:explain]\n${brief}\nReply in EXACTLY this format:\nBOTTOM_LINE: <one sentence>\n` +
        '### <title naming the actual thing>\n<at most 50 words>\n' +
        (isTrade ? '' : '') +
        codeBlock(ctx),
    },
  ];
}

export function divergePrompt(ctx: CodeContext): ChatMessage[] {
  return [
    { role: 'system', content: BASE_RULES },
    {
      role: 'user',
      content:
        `[INTENT:diverge]\nList exactly 4 genuinely different approaches to what this code does ` +
        '(including one deliberately simpler and one deliberately more scalable). One per line:\n' +
        'APPROACH: <name> — <one line on how it works>\n' +
        codeBlock(ctx),
    },
  ];
}

export function convergePrompt(ctx: CodeContext, approach: string): ChatMessage[] {
  return [
    { role: 'system', content: BASE_RULES },
    {
      role: 'user',
      content:
        `[INTENT:quickfire]\nJudge this approach for the code: "${approach}". Reply with exactly 3 lines:\n` +
        'Performance: <one line>\nReadability: <one line>\nSecurity: <one line>\n' +
        codeBlock(ctx),
    },
  ];
}

export function scamperPrompt(ctx: CodeContext, lens: string): ChatMessage[] {
  const briefs: Record<string, string> = {
    'Metaphor Mixer':
      'Metaphor Mixer challenge: pick an unrelated everyday domain and re-imagine this code as that ' +
      'thing. Give the mapping in 3 short lines, then end with one question inviting the engineer to try one change.',
    'Subtraction Dare':
      'Subtraction Dare: name the component/part of this code everyone assumes is essential, dare the ' +
      'engineer to delete it mentally, and say in 3 short lines what would actually break and what would get simpler.',
    'Reverse It':
      'Reverse It: state the exact opposite goal of this code, show in 3 short lines what the reversed ' +
      'version would look like, and what that reveals about the real design.',
  };
  return [
    { role: 'system', content: 'You set short creative challenges about code (SCAMPER). Human decides; you provoke. Brief.' },
    { role: 'user', content: `[INTENT:scamper]\n${briefs[lens] ?? briefs['Reverse It']}\n${codeBlock(ctx)}` },
  ];
}

export function mcqPrompt(concept: Concept): ChatMessage[] {
  return [
    { role: 'system', content: BASE_RULES },
    {
      role: 'user',
      content:
        `[INTENT:mcq]\nWrite ONE multiple-choice question testing real understanding of "${concept.term}" ` +
        `(truth: "${concept.bottomLine}", from ${concept.file}:${concept.line}). Format exactly:\n` +
        'Q: <question>\nA: <option>\nB: <option>\nC: <option>\nD: <option>\nANSWER: <A|B|C|D>\n' +
        'Wrong options must be plausible misconceptions, not jokes.',
    },
  ];
}

export function testSkeletonPrompt(ctx: CodeContext): ChatMessage[] {
  return [
    { role: 'system', content: BASE_RULES },
    {
      role: 'user',
      content:
        `[INTENT:test]\nWrite a minimal unit test skeleton for this code in its own language/framework ` +
        '(JUnit 5 for Java, Vitest for TS). One happy-path test and one edge-case test, with TODO comments ' +
        'where the engineer must fill in real values — writing it is the learning. Code only, plus one ' +
        'comment line at the top saying what behaviour it pins down.\n' +
        codeBlock(ctx),
    },
  ];
}

export function daySummaryPrompt(concepts: readonly Concept[]): ChatMessage[] {
  return [
    { role: 'system', content: BASE_RULES },
    {
      role: 'user',
      content:
        `[INTENT:summary]\nThe engineer marked these concepts today:\n` +
        concepts.map((c) => `- ${c.term}: ${c.bottomLine}`).join('\n') +
        '\nWrite a next-day review card: exactly 3 lines, each starting with "Hint:" — each hint nudges ' +
        'recall of one concept WITHOUT giving the answer, hardest first.',
    },
  ];
}

/** Solver (/solver skill): restate, likeliest cause + confidence, fastest check, one question. */
export function solverPrompt(
  ctx: CodeContext | null,
  problem: string,
  errorText: string,
  tried: readonly string[],
): ChatMessage[] {
  const triedLine = tried.length ? `\nAlready tried and ruled out (do NOT repeat these): ${tried.join(' | ')}` : '';
  const errorLine = errorText ? `\nError/log pasted by the engineer:\n${errorText.slice(0, 2500)}` : '';
  const codeLine = ctx ? `\nCurrently selected code:\n${codeBlock(ctx)}` : '';
  return [
    {
      role: 'system',
      content:
        'You are a sharp colleague at the next desk, pair-solving. Short, concrete, no lecture. ' +
        'Never propose editing code; propose the fastest check that confirms or rules out a cause.',
    },
    {
      role: 'user',
      content:
        `[INTENT:solver]\nProblem: ${problem}${triedLine}${errorLine}${codeLine}\n` +
        'Reply in EXACTLY this format, each on its own line:\n' +
        'RESTATE: <the problem in one sentence>\n' +
        'CAUSE: <most likely cause> (confidence: likely|possible|long shot)\n' +
        'CHECK: <single fastest check: a log line, breakpoint, command, or file to read>\n' +
        'QUESTION: <at most one question, only if information is missing>',
    },
  ];
}

export function drillPrompt(concept: Concept): ChatMessage[] {
  return [
    { role: 'system', content: BASE_RULES },
    {
      role: 'user',
      content:
        `[INTENT:drill]\nWrite ONE short drill question (no answer) that tests real understanding of this concept ` +
        `the engineer marked. Concept: "${concept.term}". What they were told: "${concept.bottomLine}" ` +
        `(from ${concept.file}:${concept.line}). Ask them to explain or predict, not to recall wording.`,
    },
  ];
}
