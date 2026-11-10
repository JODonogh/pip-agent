import type { CodeContext } from '../shared/types';

/** One prompt template per worker. The [INTENT:x] tag lets the Mock provider answer deterministically. */

export const BASE_RULES = [
  'You are a terse learning aid sitting beside an engineer in their IDE.',
  'Plain language first. One new concept per paragraph. No padding, no history unless asked.',
  'Refer to the given file and line. Use a short analogy only if it genuinely helps.',
].join(' ');

export function codeBlock(ctx: CodeContext): string {
  // Trimmed hard: shorter prompts are the cheapest latency win on a local 7B.
  // Scope-exact: the model must explain ONLY the selection. Surrounding lines
  // are reference only (e.g. a single LIKE line inside a large query).
  const selection = ctx.selection.slice(0, 3000);
  const surrounding = selection.length < 500 ? ctx.surrounding.slice(0, 400) : ctx.surrounding.slice(0, 1200);
  return (
    `File: ${ctx.file}:${ctx.line} (${ctx.language})\n` +
    `Selected code to explain — ONLY explain this (${selection.length} characters):\n\`\`\`\n${selection}\n\`\`\`\n` +
    `Reference only, DO NOT explain (nearby lines for context):\n${surrounding}`
  );
}
