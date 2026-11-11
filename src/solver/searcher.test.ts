import { describe, expect, it } from 'vitest';
import { challengePrompt, parseChallenge } from '../ideation/challenge';
import { followUpSearch, cleanReply, chatPrompt } from './chat';
import { formatHits, grepFiles, mergeHits, searchTerms, skipRepoSearchForAnswer } from './searcher';

const files = [
  { path: 'src/PartnerController.java', text: 'class PartnerController {\n  List<Partner> list() {\n    return partnerService.findFilteredInScope(criteria).stream()\n      .toList();\n  }\n}' },
  { path: 'src/Other.java', text: 'class Other { int count; }' },
];

describe('searcher', () => {
  it('skips repo search for normal-form theory when the excerpt has no schema', () => {
    expect(skipRepoSearchForAnswer('What is First Normal Form and how does it apply to this database?', 'just a note')).toBe(true);
    expect(skipRepoSearchForAnswer('What is 1NF?', 'CREATE TABLE t (id INT);')).toBe(false);
  });

  it('skips repo search for conceptual questions about an anchored reducer snippet', () => {
    const reducer = [
      'return {',
      '  ...prev,',
      '  search: nextSearch ? nextSearch : undefined,',
      '  productId: updates.productId !== undefined ? updates.productId : prev.productId,',
      '};',
    ].join('\n');
    expect(skipRepoSearchForAnswer('Why is it important to use undefined here?', reducer)).toBe(true);
    expect(skipRepoSearchForAnswer('What does findFilteredInScope do?', reducer)).toBe(false);
  });

  it('skips repo search when the question embeds inline code in backticks', () => {
    expect(
      skipRepoSearchForAnswer(
        'Why is it important to write `search: nextSearch ? nextSearch : undefined`?',
        '',
      ),
    ).toBe(true);
  });

  it('prefers code-shaped names over plain words', () => {
    const terms = searchTerms('Why does findFilteredInScope return nothing please', 'partnerService.findFilteredInScope(criteria)');
    expect(terms[0]).toBe('findFilteredInScope');
    expect(terms).not.toContain('please');
  });

  it('finds the line with file and line number, with context', () => {
    const hits = grepFiles(files, ['findFilteredInScope', 'partnerService']);
    expect(hits[0]).toMatchObject({ file: 'src/PartnerController.java', line: 3 });
    expect(hits[0]!.snippet).toContain('.toList()');
    expect(formatHits(hits)).toContain('src/PartnerController.java:3');
  });

  it('ignores a single plain word and says so when nothing matches', () => {
    expect(grepFiles(files, ['count'])).toEqual([]);
    expect(formatHits([])).toContain('No matching lines');
  });

  it('merges a second search without duplicating nearby lines', () => {
    const first = grepFiles(files, ['findFilteredInScope']);
    expect(mergeHits(first, grepFiles(files, ['partnerService']))).toHaveLength(1);
  });
});

describe('chat helpers', () => {
  it('treats a lone SEARCH line as a request to search again', () => {
    expect(followUpSearch('SEARCH: PartnerFilterCriteria')).toBe('PartnerFilterCriteria');
    expect(followUpSearch('It is in src/A.java:3.')).toBeNull();
    expect(cleanReply('SEARCH: X\nAnswer')).toBe('Answer');
  });

  it('gives pair mode a question rule and vibe mode a code rule, both with the results', () => {
    const pair = chatPrompt('pair', 'why?', [], '', 'a.java:1\nx', ['x']);
    const vibe = chatPrompt('vibe', 'fix it', [], '', 'a.java:1\nx', ['x']);
    expect(pair[0]!.content).toContain('Q:');
    expect(vibe[0]!.content).toContain('EDIT: <file path');
    expect(pair[1]!.content).toContain('SEARCH RESULTS:\na.java:1');
  });

  it('marks conceptual answer prompts so the model does not chase repo noise', () => {
    const prompt = chatPrompt('answer', 'What is First Normal Form?', [], 'excerpt', 'hits', [], '', { conceptualAnswer: true });
    expect(prompt[0]!.content).toContain('did not search the repository');
    expect(prompt[1]!.content).toContain('no repository search — conceptual question only');
  });

  it('grounds procedural answer steps in the anchored excerpt, not a fixed stack', () => {
    const system = chatPrompt('answer', 'how to verify?', [], 'const x = 1;', 'hits', ['x'])[0]!.content;
    expect(system).not.toMatch(/MockMvcResultHandlers/i);
    expect(system).not.toMatch(/\bjsonPath\b/i);
    expect(system).toContain('anchored excerpt');
  });
});

describe('idea challenge', () => {
  it('parses an assumption, questions and a counter, and forbids solutions', () => {
    const parsed = parseChallenge('ASSUMPTION: Input is never empty.\nQUESTION: What if it is?\nQUESTION: Who sends it?\nCOUNTER: A caller passes null.');
    expect(parsed).toEqual({ assumption: 'Input is never empty.', questions: ['What if it is?', 'Who sends it?'], counter: 'A caller passes null.' });
    expect(challengePrompt(null, 'cache it')[0]!.content).toContain('Never propose a solution');
  });
});

import { termFacts, formatFacts } from './searcher';
describe('grounding', () => {
  it('drops capitalised filler words when identifiers are present', () => {
    const terms = searchTerms('Optional filters. Every component may be null. PartnerFilterCriteria(String search, UUID productId, PartnerStatus status)');
    expect(terms).toEqual(expect.arrayContaining(['PartnerFilterCriteria', 'productId', 'PartnerStatus']));
    expect(terms).not.toContain('Optional');
    expect(terms).not.toContain('Every');
  });

  it('counts where an identifier really appears, including that it is only defined once', () => {
    const repo = [{ path: 'A.java', text: 'public record PartnerFilterCriteria(String s) {}' }, { path: 'B.java', text: 'class B { PartnerStatus s; }' }];
    const facts = termFacts(repo, ['PartnerFilterCriteria', 'ghostSymbol']);
    expect(facts[0]).toEqual({ term: 'PartnerFilterCriteria', files: ['A.java'], lines: 1 });
    expect(formatFacts(facts)).toContain('ghostSymbol: not found anywhere');
  });
});

import { buildHandoff, cursorPromptLink } from './chat';
describe('coach and hand-off', () => {
  it('debug mode forbids giving the fix and asks for hypotheses with checks', () => {
    const debug = chatPrompt('debug', 'why null?', [], '', 'a.java:1\nx', ['x'])[0]!.content;
    expect(debug).toContain('Never give the fix');
    expect(debug).toContain('hypotheses');
  });

  it('hands Cursor the problem, what was established, and where to look', () => {
    const text = buildHandoff('List is empty', [{ role: 'user', text: 'I think the filter is null' }, { role: 'assistant', text: 'Check A.java:3' }], [{ file: 'A.java', line: 3 }, { file: 'A.java', line: 3 }]);
    expect(text).toContain('PROBLEM:\nList is empty');
    expect(text).toContain('Me: I think the filter is null');
    expect(text.match(/A\.java:3/g)).toHaveLength(2);
    expect(decodeURIComponent(cursorPromptLink('a b&c').split('text=')[1]!)).toBe('a b&c');
  });
});

import { chatPrompt, formatCoach } from './chat';
describe('thinking modes keep only questions and hypotheses', () => {
  it('drops claims about the repository and keeps the questions', () => {
    const text = formatCoach('pair', 'The evidence shows it is used in several files.\nQ: What do you expect?\nQ: Which input differs?');
    expect(text).toContain('1. What do you expect?');
    expect(text).not.toContain('used in several files');
  });

  it('falls back to generic questions when the model ignores the format', () => {
    expect(formatCoach('pair', 'It is all fine.')).toContain('What did you expect to happen');
  });

  it('formats debug hypotheses with their check and labels them as guesses', () => {
    const text = formatCoach('debug', 'H: status is null | CHECK: log status at the controller\nIt is certainly the DB.');
    expect(text).toContain('**Maybe** status is null — check: log status at the controller');
    expect(text).toContain('not findings');
    expect(text).not.toContain('certainly');
  });

  it('gives a short direct answer with one follow-up and route chips', () => {
    const text = formatCoach('answer', 'The LIKE pattern matches names case-insensitively.\nFollow-up: Does ESCAPE apply here?');
    expect(text).toContain('LIKE pattern');
    expect(text).toMatch(/follow-up:/i);
    expect(text).toContain('Visualise');
    expect(text.split('\n').length).toBeLessThanOrEqual(8);
  });

  it('answer mode prompt targets the latest how-to question', () => {
    const prompt = chatPrompt(
      'answer',
      'How do I confirm unassignedPartner is called in the failing test?',
      [{ role: 'assistant', text: 'Q: Is the partner in the JSON response?' }],
      'test body',
      'hit',
      ['unassignedPartner'],
    )[1]!.content;
    expect(prompt).toContain('latest question');
    expect(prompt).toContain('HOW to run a check');
    expect(prompt).toContain('How do I confirm unassignedPartner');
  });

  it('adds a follow-up when the model omits one and flags unverified names', () => {
    const repo = { paths: ['src/main/PartnerController.java'], has: () => false };
    const text = formatCoach('answer', 'GhostService handles it.', repo, '', { symbolCaveat: true });
    expect(text).toMatch(/follow-up:/i);
    expect(text).toContain('Unverified here: GhostService');
  });

  it('omits unverified-symbol line when repo search was skipped', () => {
    const repo = { paths: [], has: () => false };
    const text = formatCoach('answer', 'JsonPath is not in this reply.', repo, '', { symbolCaveat: false });
    expect(text).not.toContain('Unverified here');
  });

  it('asks for a direct short answer with a follow-up line', () => {
    const prompt = chatPrompt('answer', 'What does LIKE do?', [], 'SELECT 1', 'no hits', []).map((m) => m.content).join('\n');
    expect(prompt).toContain('latest question');
    expect(prompt).toContain('Follow-up:');
  });
});

import { verifyMentions } from './chat';
describe('hypotheses are checked against the repo', () => {
  const repo = { paths: ['src/main/PartnerController.java', 'web/List.tsx'], has: (term: string) => ['findFiltered', 'partner_status'].includes(term) };

  it('separates real files and symbols from invented ones', () => {
    const result = verifyMentions('Log `findFiltered` in PartnerController.java and GhostService.java, then ask ghostHelper', repo);
    expect(result.found).toEqual(expect.arrayContaining(['PartnerController.java', 'findFiltered']));
    expect(result.missing).toEqual(expect.arrayContaining(['GhostService.java', 'ghostHelper']));
  });

  it('flags an unverifiable hypothesis, lists verified ones first, and ticks the real reference', () => {
    const text = formatCoach('debug', 'H: the join is wrong | CHECK: read GhostService.java\nH: status is filtered | CHECK: log `findFiltered` in PartnerController.java', repo);
    expect(text.indexOf('✓ in the repo')).toBeLessThan(text.indexOf('⚠ not found in the repo: GhostService.java'));
  });

  it('drops a question that names something that is not in the repo', () => {
    const text = formatCoach('pair', 'Q: What does GhostService.java return?\nQ: What input reaches findFiltered?', repo);
    expect(text).not.toContain('GhostService');
    expect(text).toContain('1. What input reaches findFiltered?');
  });
});

import { closedSets, expandTerms, stringConstants, valueSets } from './searcher';
import { dropSettled } from '../ideation/challenge';
describe('fixed value lists', () => {
  const repo = [
    { path: 'api/PartnerStatus.java', text: '// statuses\npublic enum PartnerStatus {\n  ACTIVE("a"), SUSPENDED("s"),\n  OFFBOARDED("o");\n  PartnerStatus(String code) {}\n}' },
    { path: 'web/types.ts', text: "export type PartnerStatus =\n  | 'ACTIVE'\n  | 'SUSPENDED';\nexport const PARTNER_STATUS_OPTIONS = ['ACTIVE', 'SUSPENDED'] as const;" },
    { path: 'web/__tests__/status.test.ts', text: "const all = ['ACTIVE', 'SUSPENDED', 'OFFBOARDED', 'IDP_CONFIGURED'];" },
    { path: 'web/StatusSelect.tsx', text: "const options = [\n 'ACTIVE',\n 'SUSPENDED',\n 'OFFBOARDED',\n 'IDP_CONFIGURED',\n];" },
  ];

  it('spells snake_case names the way Java and TypeScript do', () => {
    expect(expandTerms(['partner_status', 'restrictToScope'])).toEqual(['partner_status', 'restrictToScope', 'PartnerStatus']);
    expect(expandTerms(['PartnerStatus', 'partner_status'])).toEqual(['PartnerStatus', 'partner_status']);
  });

  it('reads enums, unions and constant arrays that close a name over a list of values', () => {
    const sets = closedSets(repo, ['PartnerStatus']);
    expect(sets.find((set) => set.kind === 'enum')).toMatchObject({ file: 'api/PartnerStatus.java', line: 2, values: ['ACTIVE', 'SUSPENDED', 'OFFBOARDED'] });
    expect(sets.find((set) => set.kind === 'union')).toMatchObject({ file: 'web/types.ts', values: ['ACTIVE', 'SUSPENDED'] });
    expect(sets.find((set) => set.kind === 'list')).toMatchObject({ name: 'PARTNER_STATUS_OPTIONS', values: ['ACTIVE', 'SUSPENDED'] });
  });

  it('finds the file that writes the query\'s values side by side, ahead of tests', () => {
    const literals = stringConstants("a = 'ACTIVE' OR a = 'SUSPENDED' OR a = 'OFFBOARDED' OR a = 'IDP_CONFIGURED' OR b = '%'");
    expect(literals).toEqual(['ACTIVE', 'SUSPENDED', 'OFFBOARDED', 'IDP_CONFIGURED']);
    const found = valueSets(repo, literals);
    expect(found[0]).toMatchObject({ file: 'web/StatusSelect.tsx', kind: 'together' });
    expect(found.at(-1)!.file).toBe('web/__tests__/status.test.ts');
  });

  it('drops only the questions about values outside a list the repository already fixes', () => {
    const challenge = { assumption: 'a', questions: ['What if status is an unexpected value?', 'Which status do admins use most?', 'What if the table is empty?'], counter: 'Fails with an invalid status.' };
    const result = dropSettled(challenge, ['PartnerStatus', 'Status']);
    expect(result.questions).toEqual(['Which status do admins use most?', 'What if the table is empty?']);
    expect(result.counter).toBe('');
    expect(result.dropped).toBe(1);
    expect(dropSettled(challenge, []).questions).toHaveLength(3);
  });
});
