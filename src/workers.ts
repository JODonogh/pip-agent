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

export function explainPrompt(ctx: CodeContext, focus?: string): ChatMessage[] {
  const focusLine = focus ? `\nThe engineer clicked on this term and wants it explained: "${focus}"` : '';
  return [
    { role: 'system', content: BASE_RULES },
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
