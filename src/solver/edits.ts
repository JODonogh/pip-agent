/**
 * Vibe-solve edits: the model proposes exact find/replace blocks, code checks them against the real file,
 * and nothing is written until the engineer clicks Apply.
 */

export interface EditProposal {
  file: string;
  find: string;
  replace: string;
}

const BLOCK = /^EDIT:[ \t]*(.+?)[ \t]*\r?\nFIND:[ \t]*\r?\n([\s\S]*?)\r?\nREPLACE:[ \t]*\r?\n([\s\S]*?)^END[ \t]*$/gm;

const unfence = (text: string): string => text.replace(/^```[^\n]*\n?/gm, '');

export function parseEdits(reply: string): EditProposal[] {
  return [...unfence(reply).matchAll(BLOCK)]
    .map((match) => ({
      file: match[1]!.replace(/^[`'"]|[`'"]$/g, ''),
      find: match[2]!,
      replace: match[3]!.replace(/\r?\n$/, ''),
    }))
    .filter((edit) => edit.find.trim().length > 0)
    .slice(0, 5);
}

/** The explanation without the raw edit blocks, which are shown as reviewable proposals instead. */
export function stripEdits(reply: string): string {
  return unfence(reply).replace(BLOCK, '').replace(/\n{3,}/g, '\n\n').trim();
}

export type Located = { ok: true; start: number } | { ok: false; reason: string };

/** An edit applies only when its find text occurs exactly once in the file. */
export function locate(text: string, find: string): Located {
  if (!find.trim()) return { ok: false, reason: 'The edit has nothing to find.' };
  const first = text.indexOf(find);
  if (first < 0) return { ok: false, reason: 'The text to replace was not found exactly in the file.' };
  if (text.indexOf(find, first + 1) >= 0) return { ok: false, reason: 'The text to replace appears more than once, so the edit is ambiguous.' };
  return { ok: true, start: first };
}
