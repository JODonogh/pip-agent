import { describe, expect, it, vi } from 'vitest';
import { loadComparisonSources, readConfinedTestSource, testSourceExcerpt, type WorkspaceSourceAccess } from './comparison';
import { evaluateSolver, solverInput } from './solver';
import { solverPrompt } from './prompts';

const testSource = `class T {
  @Test void scopeFilters() {
    var found = service.findFiltered(new Scope.All());
    assertThat(found).containsExactly("Acme");
  }
  @Test void missing() { assertThat(result).isEmpty(); }
}`;

describe('test source comparison', () => {
  it('extracts explicit methods and assertion evidence with line labels and an omission caveat', () => {
    const excerpt = testSourceExcerpt(testSource);
    expect(excerpt).toContain('scopeFilters (line 2)');
    expect(excerpt).toContain('missing (line 6)');
    expect(excerpt).toContain('assertThat(found).containsExactly("Acme")');
    expect(excerpt).toContain('not complete method bodies');
  });
  it('reads only an explicit comparison of exactly two referenced test files and reports failures', async () => {
    const read = vi.fn(async (ref: { path: string }) => {
      if (ref.path === 'BTest.java') throw new Error('not found');
      return testSource;
    });
    const result = await loadComparisonSources('Compare ATest.java and BTest.java tests', read);
    expect(read).toHaveBeenCalledTimes(2);
    expect(result?.sources).toHaveLength(1);
    expect(result?.issues[0]).toContain('BTest.java');
    expect(await loadComparisonSources('Error in ATest.java', read)).toBeNull();
  });
  it('recognises the screenshot question with references in the error box', async () => {
    const read = vi.fn(async () => testSource);
    const result = await loadComparisonSources('do these files not do alot of the same testing\nATest.java\nBTest.java', read);
    expect(result?.sources).toHaveLength(2);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('supplies both excerpts to the model and validates quoted evidence against them', async () => {
    const result = await loadComparisonSources('Compare ATest.java and BTest.java tests', async () => testSource);
    const sources = result!.sources;
    const messages = solverPrompt(null, 'Compare tests', '', [], 'direct', sources);
    expect(messages[0]!.content).toContain('Never decide one is better from assertion or test counts alone');
    expect(messages[1]!.content).toContain('Selected workspace file excerpts ATest.java');
    expect(messages[1]!.content).toContain('Selected workspace file excerpts BTest.java');
    const input = { ...solverInput(null, 'Compare tests', ''), comparedSources: sources };
    const reply = evaluateSolver('CAUSE: scope tests (confidence: possible)\nEVIDENCE: `assertThat(found).containsExactly("Acme")`', input);
    expect(reply.evidence).toContain('assertThat(found).containsExactly("Acme")');
  });
});

describe('workspace source access', () => {
  const encoder = new TextEncoder();
  function access(overrides: Partial<WorkspaceSourceAccess> = {}): WorkspaceSourceAccess {
    return { candidates: async () => ['/workspace/tests/ATest.java'], workspaceRoot: () => '/workspace', canonical: async (p) => p,
      stat: async () => ({ isFile: true, size: testSource.length }), read: async () => encoder.encode(testSource), ...overrides };
  }
  it('reads one unique workspace source, without accepting ambiguous basenames', async () => {
    expect(await readConfinedTestSource({ path: 'tests/ATest.java' }, access())).toBe(testSource);
    await expect(readConfinedTestSource({ path: 'ATest.java' }, access({ candidates: async () => ['/workspace/a/ATest.java', '/workspace/b/ATest.java'] }))).rejects.toThrow('ambiguous');
  });
  it('rejects a symlink escaping the canonical workspace before reading', async () => {
    const read = vi.fn(async () => encoder.encode(testSource));
    await expect(readConfinedTestSource({ path: 'tests/ATest.java' }, access({ canonical: async (p) => p.endsWith('.java') ? '/outside/secret.java' : p, read }))).rejects.toThrow('Outside workspace');
    expect(read).not.toHaveBeenCalled();
  });
  it('rejects oversized or binary files and checks size again after reading', async () => {
    await expect(readConfinedTestSource({ path: 'ATest.java' }, access({ stat: async () => ({ isFile: true, size: 32769 }) }))).rejects.toThrow();
    await expect(readConfinedTestSource({ path: 'ATest.java' }, access({ read: async () => new Uint8Array(32769) }))).rejects.toThrow();
    await expect(readConfinedTestSource({ path: 'ATest.java' }, access({ read: async () => new Uint8Array([255]) }))).rejects.toThrow();
  });
});


it('replaces a vague comparison with named, source-grounded shared themes', () => {
  const input = { ...solverInput(null, 'Do these tests overlap?', ''), comparedSources: [
    { path: 'ATest.java', text: 'Test methods found in source: searchByName (line 7), statusActive (line 12)' },
    { path: 'BTest.java', text: 'Test methods found in source: searchNames (line 9), statusFilter (line 15)' },
  ] };
  const reply = evaluateSolver('CAUSE: It is unclear if these tests overlap (confidence: possible)\nCHECK: Review the test names.', input, [], 'direct');
  expect(reply.cause).toContain('searchByName / searchNames');
  expect(reply.cause).toContain('statusActive / statusFilter');
  expect(reply.cause).toContain('not proof');
  expect(reply.evidence).toEqual(['searchByName', 'searchNames']);
});

it('names visible repository and service entry points when a model denies overlap', () => {
  const input = { ...solverInput(null, 'Do these test files cover the same testing?', ''), comparedSources: [
    { path: 'PartnerRepositoryFilterIntTest.java', text: 'Test methods found in source: searchLiteral (line 1), statusSuspended (line 4), productFilter (line 9)\nL2: this.partnerRepository.findFiltered("a", null, null);' },
    { path: 'PartnerServiceFilterIntTest.java', text: 'Test methods found in source: searchEscaped (line 1), statusFilter (line 4), productMatches (line 9)\nL2: this.partnerService.findFilteredInScope(scope, criteria);' },
  ] };
  const reply = evaluateSolver('RESTATE: There is no significant overlap.\nCAUSE: Different purposes.', input, [], 'direct');
  expect(reply.cause).toContain('partnerRepository.findFiltered()');
  expect(reply.cause).toContain('partnerService.findFilteredInScope()');
  expect(reply.cause).toContain('search');
  expect(reply.cause).toContain('not proof');
  expect(reply.restate).not.toContain('no significant overlap');
});
