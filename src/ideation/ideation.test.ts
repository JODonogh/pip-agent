import { describe, expect, it } from 'vitest';
import { verifyIdeas } from './ideation';
import { divergePrompt, ideaHelpPrompt, improveCodebasePrompt, pocBlueprintPrompt, pocIdeasPrompt, scamperPrompt, verifierPrompt } from './prompts';
import type { CodeContext } from '../shared/types';

const ctx: CodeContext = {
  file: 'src/PartnerTest.java', line: 10, language: 'java',
  selection: 'UUID scopeId = UUID.randomUUID();\nvar result = partnerService.findFilteredInScope(scope, criteria);',
  surrounding: 'class PartnerTest {}',
};
const text = (messages: ReturnType<typeof improveCodebasePrompt>) => messages.map((message) => message.content).join('\n');

describe('independent idea verification', () => {
  it('accepts only exact source evidence and never claims a live test ran', () => {
    const result = verifyIdeas('VERIFY: 1 | supported | `UUID.randomUUID()` | The fixture randomises scope. | Repeat with a fixed scope. | Vary one input.', ctx, 1);
    expect(result[0]).toMatchObject({ level: 'Context supported', evidence: 'UUID.randomUUID()' });
    expect(result[0]?.challenge).toContain('No live test was run');
  });

  it('downgrades fabricated evidence, including the reviewer claiming certainty', () => {
    const result = verifyIdeas('VERIFY: 1 | supported | buildScope() | Proven safe and faster. | Deploy it. | Use a builder.', ctx, 1);
    expect(result[0]?.level).toBe('Speculation');
    expect(result[0]?.evidence).toBe('');
    expect(result[0]?.challenge).toContain('no matching code quote');
    expect(result[0]?.challenge).not.toContain('Proven safe');
  });

  it('keeps absent or unavailable reviews as speculation', () => {
    expect(verifyIdeas('', ctx, 2).map((review) => review.level)).toEqual(['Speculation', 'Speculation']);
    const offline = verifyIdeas('VERIFY: 1 | supported | UUID.randomUUID() | Correct. | Apply it. | Remember.', ctx, 1, true);
    expect(offline[0]?.level).toBe('Speculation');
    expect(offline[0]?.challenge).toContain('unavailable');
  });

  it('caps unmeasured performance claims even when a quote matches', () => {
    const result = verifyIdeas('VERIFY: 1 | supported | UUID.randomUUID() | This is faster. | Replace with toString. | Optimize UUIDs.', ctx, 1, false,
      ['Optimize UUID generation to reduce overhead using UUID.randomUUID().toString().']);
    expect(result[0]?.level).toBe('Speculation');
    expect(result[0]?.challenge).toContain('controlled measurement');
  });

  it('requires source evidence for a refutation as well as support', () => {
    expect(verifyIdeas('VERIFY: 1 | refuted | invented() | Impossible. | Stop. | Nothing.', ctx, 1)[0]?.level).toBe('Speculation');
    expect(verifyIdeas('VERIFY: 1 | refuted | UUID.randomUUID() | Still generates a UUID. | Check return types. | Trace types.', ctx, 1)[0]?.level).toBe('Refuted');
  });

  it('does not accept quotes beyond the excerpt actually sent to the model', () => {
    const long = { ...ctx, selection: 'x'.repeat(3000) + '\nsecretTail()' };
    expect(verifyIdeas('VERIFY: 1 | supported | secretTail() | Found it. | Read it. | Trace it.', long, 1)[0]?.level).toBe('Speculation');
  });
});

describe('learning-focused ideation prompts', () => {
  it('targets the supplied pain point with a falsifiable trial and a rejection criterion', () => {
    const prompt = text(pocIdeasPrompt(ctx, 'crashing tests'));
    expect(prompt).toContain('crashing tests');
    expect(prompt).toContain('do not ignore the pain point');
    expect(prompt).toContain('30-120 minute');
    expect(prompt).toContain('rejection criterion');
    expect(prompt).not.toContain('Invent 3 POC ideas');
    expect(text(improveCodebasePrompt(ctx))).toContain('fewer is better than padding');
  });

  it('uses one consistent metaphor with limits and an original-code question', () => {
    const prompt = text(scamperPrompt(ctx, 'Metaphor'));
    expect(prompt).toContain('ONE everyday domain');
    expect(prompt).toContain('one limit of the analogy');
    expect(prompt).toContain('ORIGINAL code');
    expect(text(scamperPrompt(ctx, 'Metaphor Mixer'))).toBe(prompt);
    expect(text(divergePrompt(ctx))).toContain('one trade-off');
  });

  it('gives the verifier only candidate claims and code, and teaches a reusable investigation habit', () => {
    const review = text(verifierPrompt(ctx, ['The fixture varies its scope.']));
    expect(review).toContain('separate critical reviewer');
    expect(review).toContain('no tools, measurements');
    expect(review).toContain(ctx.selection);
    const verification = verifyIdeas('', ctx, 1)[0]!;
    const help = text(ideaHelpPrompt(ctx, 'The fixture varies its scope.', verification, 'learn'));
    expect(help).toContain('one alternative');
    expect(help).toContain('one tiny exercise');
    expect(help).toContain('at most 100 words');
    expect(text(ideaHelpPrompt(ctx, 'Fixture', verification, 'ask', 'Why does scope matter?'))).toContain('Why does scope matter?');
  });
});


describe('experiment and metaphor quality', () => {
  it('connects prototypes to business acceptance, architecture and a concrete edge case without inventing value', () => {
    const prompt = text(pocIdeasPrompt(ctx, 'Partners cannot find linked products'));
    expect(prompt).toContain('Partners cannot find linked products');
    expect(prompt).toContain('supplied user or business outcome');
    expect(prompt).toContain('one concrete edge case');
    expect(prompt).toContain('a simpler alternative');
    expect(prompt).toContain('Do not invent business context');
    expect(prompt).toContain('Business success measure AND rejection criterion');
    expect(text(pocIdeasPrompt(ctx))).toContain('Ask which user or business outcome matters');
  });

  it('keeps the existing blueprint sections while making the engineer defend why and how the prototype works', () => {
    const prompt = text(pocBlueprintPrompt(ctx, 'Find linked products', 'Trial a filter at the existing entry point.'));
    expect(prompt.match(/^### .+$/gm)).toEqual(['### Baseline', '### Smallest trial', '### Decide and remember']);
    expect(prompt).toContain('current user case and one concrete edge case');
    expect(prompt).toContain('architecture choice versus a simpler alternative and why');
    expect(prompt).toContain('defend why this design');
    expect(prompt).toContain('explain how the edge case flows');
    expect(prompt).toContain('ask what matters');
  });

  it('retains falsifiable fallback trials and asks for business criteria before declaring success', async () => {
    const { usefulExperiment, experimentScaffolds } = await import('./ideation');
    for (const seed of ['crashing tests', 'partners cannot find products']) {
      const trial = experimentScaffolds(ctx, seed)[0]!;
      expect(usefulExperiment(trial)).toBe(true);
      expect(trial.hook).toMatch(/user\/business/);
      expect(`${trial.slice} ${trial.demo}`).toContain('edge case');
      expect(trial.demo).toMatch(/business (?:behaviour|acceptance)/);
      expect(trial.demo).toContain('why');
      expect(trial.demo).toContain('how');
    }
  });

  it('replaces vague test restatements with falsifiable controlled trials', async () => {
    const { usefulExperiment, experimentScaffolds } = await import('./ideation');
    const ctx = { file: 'FilterTest.java', line: 1, language: 'java', selection: 'void filterPartners() { partnerService.findFiltered(scope, criteria); }', surrounding: '' };
    expect(usefulExperiment({ title: 'Test filtering', hook: 'Tests the filter', hypothesis: 'It filters partners', slice: 'Run the test', demo: 'It contains partner' })).toBe(false);
    const trial = experimentScaffolds(ctx, 'crashing tests')[0]!;
    expect(usefulExperiment(trial)).toBe(true);
    expect(trial.slice).toContain('first failing line');
    expect(trial.demo).toContain('reject order dependence');
  });

  it('keeps a filtering metaphor in one everyday domain and states its limit', async () => {
    const { metaphorScaffold } = await import('./ideation');
    const text = metaphorScaffold({ file: 'Filter.java', line: 1, language: 'java', selection: 'findFiltered(scope, criteria)', surrounding: '' });
    expect(text).toContain('Library desk');
    expect(text).toContain('Limit:');
    expect(text).toContain('Try:');
    expect(text).not.toMatch(/recipe|kitchen|rename/);
  });
});
