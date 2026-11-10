import { describe, expect, it } from 'vitest';
import { evaluateSolver, solverInput, solverKeywords, restoredSolverContext } from './solver';
import { solverCheckPrompt, solverPrompt } from './prompts';
import { evaluateDuck } from '../shared/evaluator';
import type { CodeContext } from '../shared/types';

const error = [
  '  symbol:   method findFilteredInScope(Partners,PartnerFilterCriteria)',
  '  location: variable partnerService of type PartnerService',
  '  /Users/jonathan.odonoghue/GlobalPartnerPortal/global-portal-shared/src/test/java/inttest/partner/PartnerServiceFilterIntTest.java:105: error: cannot find symbol',
  '      final var result = this.partnerService.findFilteredInScope(',
].join('\n');
const unrelated: CodeContext = {
  file: 'PartnerRepositoryFilterIntTest.java', line: 12, language: 'java',
  selection: 'repository.findFiltered(scope, criteria, page);', surrounding: 'class PartnerRepository {}',
};
const fabricated = [
  'RESTATE: PartnerRepositoryFilterIntTest.java fails in findFiltered.',
  'CAUSE: findFiltered requires two parameters instead of three (confidence: likely)',
  'CHECK: Review PartnerRepository.java.',
  'WHY: Its declaration takes two arguments.',
  'EVIDENCE: `findFiltered(Partners, PartnerFilterCriteria)`',
  'UNKNOWN: Nothing.',
].join('\n');

describe('solver evidence and diagnostic guard', () => {
  it('grounds the reported Java error even when pasted into the problem and selected code differs', () => {
    const input = solverInput(unrelated, `I am getting the following:\n${error}`, '');
    const reply = evaluateSolver(fabricated, input);
    expect(reply.restate).toContain('PartnerService.findFilteredInScope(Partners,PartnerFilterCriteria)');
    expect(reply.restate).toContain('PartnerServiceFilterIntTest.java:105');
    expect(reply.restate).not.toContain('PartnerRepository');
    expect(reply.cause).toContain('PartnerService');
    expect(reply.cause).not.toContain('instead of');
    expect(reply.confidence).toBe('possible');
    expect(reply.check).not.toContain('PartnerRepository');
    expect(reply.unknown).toContain('not established');
    expect(reply.evidence).toHaveLength(3);
    for (const quote of reply.evidence) expect(input.problem.includes(quote)).toBe(true);
  });

  it('recognises the same diagnostic from the optional error box', () => {
    const reply = evaluateSolver('', solverInput(null, 'Build fails', error));
    expect(reply.restate).toContain('Java compilation');
    expect(reply.cause).toContain('PartnerService');
  });

  it('does not force the same hypothesis after it was tried', () => {
    const raw = 'RESTATE: Something failed.\nCAUSE: A stale dependency may supply another version (confidence: possible)\nCHECK: Inspect dependency versions.\nWHY: A missing method can occur with a stale dependency.\nEVIDENCE: "error: cannot find symbol"';
    const reply = evaluateSolver(raw, solverInput(unrelated, error, ''), ['The compile-time type may not expose it.']);
    expect(reply.cause).toContain('stale dependency');
    expect(reply.restate).toContain('PartnerService.findFilteredInScope');
    expect(reply.check).toBe('Inspect dependency versions.');
  });

  it('rejects invented evidence and downgrades an unsupported hypothesis', () => {
    const reply = evaluateSolver(fabricated, solverInput(null, 'The endpoint returns 500.', 'NullPointerException: cart.total is null'));
    expect(reply.confidence).toBe('long shot');
    expect(reply.reason).toContain('unverified');
    expect(reply.evidence).toEqual(['NullPointerException: cart.total is null']);
  });

  it('keeps ordinary runtime hypotheses and exact quoted clues', () => {
    const input = solverInput(null, 'The endpoint returns 500.', 'NullPointerException: cart.total is null');
    const reply = evaluateSolver([
      'RESTATE: The endpoint fails for a cart.',
      'CAUSE: total may be unset (confidence: likely)',
      'CHECK: Log total before reduction.',
      'QUESTION: Does it fail for empty carts?',
      'WHY: The exception identifies the null value.',
      'EVIDENCE: `cart.total is null` | "NullPointerException" | "invented clue"',
      'UNKNOWN: Where total is assigned.',
    ].join('\n'), input);
    expect(reply.cause).toBe('total may be unset');
    expect(reply.confidence).toBe('likely');
    expect(reply.evidence).toEqual(['cart.total is null', 'NullPointerException']);
    expect(reply.reason).toBe('The exception identifies the null value.');
    expect(reply.unknown).toBe('Where total is assigned.');
  });

  it('labels and validates only the bounded text actually supplied', () => {
    const input = solverInput({ ...unrelated, selection: 's'.repeat(3000) + 'secretTail', surrounding: 'n'.repeat(1300) }, 'p'.repeat(4100), 'e'.repeat(2600));
    expect(input.problem).toHaveLength(4000);
    expect(input.errorText).toHaveLength(2500);
    expect(input.ctx?.selection).toHaveLength(3000);
    expect(input.ctx?.surrounding).toHaveLength(1200);
    expect(input.sources).toContain('Problem text (4000 characters)');
    expect(input.sources).toContain('Pasted error/log (2500 characters)');
    expect(input.sources.join(' ')).toContain('PartnerRepositoryFilterIntTest.java:12 (3000 characters)');
    const reply = evaluateSolver('CAUSE: A value is wrong (confidence: likely)\nEVIDENCE: secretTail', input);
    expect(reply.reason).toContain('unverified');
    expect(reply.evidence).not.toContain('secretTail');
    expect(unrelated.selection).toBe('repository.findFiltered(scope, criteria, page);');
  });

  it('does not mistake a runtime cannot-find message for a Java method diagnostic', () => {
    const reply = evaluateSolver('RESTATE: Lookup fails.\nCAUSE: Missing mapping (confidence: possible)', solverInput(null, 'cannot find symbol in my runtime lookup', ''));
    expect(reply.restate).toBe('Lookup fails.');
  });
});

describe('solver topics', () => {
  it('offers advanced concepts without files, method identifiers or basic terminology', () => {
    expect(solverKeywords('PartnerService.java findFilteredInScope method signature; overload resolution depends on the compile-time type and classpath.')).toEqual([
      'overload resolution', 'classpath', 'compile-time type',
    ]);
    expect(solverKeywords('myclasspath.java classpathResolver depENDENCY injection')).toEqual(['dependency injection']);
  });
});

describe('rubber-duck feedback', () => {
  it('keeps a direct correction without inventing a basic recall question', () => {
    const correction = 'Does not hold: this is a compiler diagnostic, so this test has not started running.';
    expect(evaluateDuck(correction)).toEqual({ text: correction, repaired: false });
  });

  it('keeps the useful first question and removes additional questions', () => {
    const reply = evaluateDuck('Partly holds: the declared type controls lookup.\nWhich type declares the method?\nCould it be an overload?');
    expect(reply.text).toContain('Which type declares the method?');
    expect(reply.text).not.toContain('Could it be an overload?');
  });
});


describe('solver modes and checking answers', () => {
  it('requests a direct answer or one collaborative question, with actionable unrun validation', () => {
    const direct = solverPrompt(null, 'API returns 500', '', [], 'direct').map(m => m.content).join(' ');
    const together = solverPrompt(null, 'API returns 500', '', [], 'together').map(m => m.content).join(' ');
    expect(direct).toContain('Answer the engineer’s actual question directly');
    expect(direct).toContain('QUESTION: <leave blank>');
    expect(together).toContain('one focused, answerable question');
    expect(together).toContain('Bruno only when an HTTP endpoint is relevant');
    expect(together).toContain('do not claim to have run tests');
  });
  it('returns a question only in together mode and preserves the suggested strategy', () => {
    const raw = 'CAUSE: an invalid value (confidence: possible)\nQUESTION: Which value was passed?\nSTRATEGY: Set a breakpoint at the call and inspect the value.\nEVIDENCE: invalid input';
    const input = solverInput(null, 'invalid input', '');
    expect(evaluateSolver(raw, input, [], 'direct').question).toBe('');
    expect(evaluateSolver(raw, input, [], 'together').question).toBe('Which value was passed?');
    expect(evaluateSolver(raw, input, [], 'together').strategy).toContain('breakpoint');
  });
  it('supplies an actionable validation strategy when the model omits one', () => {
    expect(evaluateSolver('', solverInput(unrelated, 'Unexpected output', '')).strategy).toContain('breakpoint');
    expect(evaluateSolver('', solverInput(null, 'GET /partners returns 500', '')).strategy).toContain('Bruno');
    expect(evaluateSolver('', solverInput(null, 'Build fails', '')).strategy).not.toContain('Bruno');
  });
  it('checks the engineer answer against the original problem, question and captured code', () => {
    const input = solverInput(unrelated, 'Original problem', 'Original error');
    const messages = solverCheckPrompt(input, 'Which type?', 'PartnerService');
    expect(messages[0]?.content).toContain('not independently verified');
    expect(messages[1]?.content).toContain('Original problem');
    expect(messages[1]?.content).toContain('Original error');
    expect(messages[1]?.content).toContain('repository.findFiltered');
    expect(messages[1]?.content).toContain('Which type?');
    expect(messages[1]?.content).toContain('PartnerService');
  });
  it('validates and bounds a restored captured selection', () => {
    expect(restoredSolverContext({ ...unrelated, line: -1 })).toBeNull();
    expect(restoredSolverContext({ ...unrelated, selection: '' })).toBeNull();
    const restored = restoredSolverContext({ ...unrelated, selection: 'x'.repeat(5000), surrounding: 'z'.repeat(2000) });
    expect(restored?.selection).toHaveLength(3000);
    expect(restored?.surrounding).toHaveLength(1200);
  });
});


describe('explaining an observed relationship test', () => {
  const code = `@Test void productFilter_matchesLinkedPartners() {
    this.partnerProductRepository.save(PartnerProduct.builder()
      .partner(this.acme).product(this.testProduct).idpEnabled(true).build());
    final var result = this.partnerService.findFilteredInScope(
      new AuthorizationScope.All(), new PartnerFilterCriteria(null, this.testProduct.getId(), null));
    assertThat(result).extracting(Partner::getId).containsExactly(this.acme.getId());
  }`;
  it('answers the question using the save, filter and assertion without inventing a failure', () => {
    const input = solverInput({ ...unrelated, selection: code }, 'How does this test if the partners are linked?', '');
    const reply = evaluateSolver('CAUSE: something is wrong (confidence: likely)', input, [], 'direct');
    expect(reply.observed).toBe(true);
    expect(reply.cause).toContain('PartnerProduct');
    expect(reply.cause).toContain('this.acme');
    expect(reply.cause).toContain('this.testProduct.getId()');
    expect(reply.cause).toContain('expects exactly');
    expect(reply.unknown).toContain('does not establish');
    expect(reply.cause).not.toContain('wrong');
    expect(reply.evidence.every(quote => code.includes(quote))).toBe(true);
  });
  it('does not infer a relationship if the result assertion is missing', () => {
    const input = solverInput({ ...unrelated, selection: code.replace('.containsExactly(this.acme.getId())', '.isEmpty()') }, 'How does this test the relationship?', '');
    const reply = evaluateSolver('CAUSE: Need more context (confidence: possible)', input, [], 'direct');
    expect(reply.cause).toBe('Need more context');
  });
});
