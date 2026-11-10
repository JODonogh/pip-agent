import { describe, expect, it } from 'vitest';
import { readCoverage, visualise } from './visualise';
const ctx = { file: 'src/Test.ts', line: 10, language: 'typescript', selection: 'function check(value) {\nif (value) { repo.save(value); return api.send(value); }\nreturn null;\n}', surrounding: "import api from './api';" };
describe('Visualise evidence', () => {
  it('offers decisions, circuit, wireframe and context without claiming measured coverage', () => {
    const diagrams = visualise(ctx);
    expect(diagrams.availableTypes).toEqual(expect.arrayContaining(['decisions', 'circuit', 'wireframe']));
    expect(diagrams.decisions.nodes.filter(n => n.kind === 'assert').map(n => n.coverageState)).toEqual(['unknown', 'unknown']);
    expect(diagrams.availableTypes).not.toContain('cartesian');
    expect(diagrams.availableTypes).toContain('growth');
    expect(diagrams.growth.series?.map(line => line.name)).toEqual(['n', '2n', 'n²']);
    expect(diagrams.growth.caption).toContain('not measurements');
    expect(diagrams.availableTypes).not.toContain('context');
  });
  it('maps an unambiguous Istanbul if report to observed and missed outcomes', () => {
    const raw = JSON.stringify({ '/repo/src/Test.ts': { branchMap: { 0: { type: 'if', loc: { start: { line: 11 } } } }, b: { 0: [2, 0] } } });
    const coverage = readCoverage(raw, ctx.file);
    const tree = visualise(ctx, coverage).decisions;
    expect(tree.nodes.filter(n => n.kind === 'assert').map(n => n.coverageState)).toEqual(['covered', 'missed']);
  });
  it('keeps JaCoCo true/false outcomes unknown while showing measured line totals', () => {
    const report = readCoverage('<report><package name="foo"><sourcefile name="A.java"><line nr="11" mb="1" cb="1"/></sourcefile></package></report>', 'src/foo/A.java');
    const tree = visualise({ ...ctx, file: 'src/foo/A.java' }, report).decisions;
    expect(tree.nodes[0]?.coverage).toMatchObject({ covered: 1, total: 2 });
    expect(tree.nodes.filter(n => n.kind === 'assert').every(n => n.coverageState === 'unknown')).toBe(true);
  });
  it('rejects mismatched and malformed reports and never transfers coverage to another file', () => {
    expect(() => readCoverage('{}', ctx.file)).toThrow();
    expect(() => readCoverage('not a report', ctx.file)).toThrow();
    const diagrams = visualise(ctx, { file: 'other/Test.ts', lines: { 11: { covered: 1, total: 2, source: 'test', outcomes: [1, 0] } } });
    expect(diagrams.decisions.nodes.filter(n => n.kind === 'assert').every(n => n.coverageState === 'unknown')).toBe(true);
  });
});


describe('relevance for parseStatus', () => {
  const sample = { file: 'PartnerService.java', line: 1, language: 'java', selection: `private static PartnerStatus parseStatus(final String status) {
    if (status == null) { return null; }
    try { return PartnerStatus.valueOf(status.trim().toUpperCase(Locale.ROOT)); }
    catch (final IllegalArgumentException e) { throw new IllegalArgumentException("Invalid partner status"); }
  }`, surrounding: 'import java.util.Locale;' };
  it('shows a clearly labelled, limited model of the actual string operations', () => {
    const result = visualise(sample);
    expect(result.availableTypes).toEqual(expect.arrayContaining(['growth', 'cartesian']));
    expect(result.cartesian.series?.map(line => line.name)).toEqual(['One pass: n', 'Two passes: 2n']);
    expect(result.cartesian.caption).toContain('trim().toUpperCase()');
    expect(result.cartesian.caption).toContain('not a benchmark');
    expect(result.cartesian.series?.[0]?.description).toContain('trim or uppercase');
    expect(result.cartesian.series?.[1]?.description).toContain('enum lookup');
    expect(result.cartesian.series?.[1]?.points.at(-1)).toEqual({ x: 16, y: 32 });
  });
  it('does not present the input string or enum lookup as system dependencies', () => {
    const result = visualise(sample);
    for (const type of ['dependencies', 'circuit', 'wireframe', 'context']) expect(result.availableTypes).not.toContain(type);
  });
  it('shows actual collaborator calls with their method names, not imports', () => {
    const result = visualise({ ...sample, selection: 'public void save() { partnerService.save(); auditClient.record(); }' });
    expect(result.availableTypes).toEqual(expect.arrayContaining(['dependencies', 'circuit', 'wireframe']));
    expect(result.dependencies.nodes.slice(1).map(node => node.label)).toEqual(['partnerService.save()', 'auditClient.record()']);
    expect(result.dependencies.nodes.slice(1).every(node => node.kind === 'call')).toBe(true);
  });
});


it('does not invent an architecture diagram from imports alone', () => {
  const result = visualise({ file: 'A.java', line: 1, language: 'java', selection: 'import java.util.Locale;\npublic String normalise(String s) { return s.trim(); }', surrounding: '' });
  expect(result.availableTypes).not.toContain('architecture');
});


describe('request test diagrams', () => {
  const sample = { file: 'test.tsx', line: 20, language: 'typescript', surrounding: '', selection: `
    await screen.findByText('Partners');
    expect(requests.map(url => url.pathname)).toEqual(['/partners', '/products']);
    expect(Object.fromEntries(requests[0].searchParams)).toEqual({ page: '1' });
    expect(requests).toHaveLength(3);
    fireEvent.click(screen.getByTestId('next'));
    fireEvent.click(screen.getByTestId('next'));
    expect(requests.length).toBe(4);
    queryClient.clear();
  ` };
  it('maps actual request transformations rather than a generic call list', () => {
    const result = visualise(sample);
    expect(result.dataFlow.nodes.map(node => node.label)).toEqual(['requests', 'requests.map(…pathname)', 'Expected paths', 'requests[0].searchParams', 'Expected parameters']);
    expect(result.dataFlow.edges).toEqual(expect.arrayContaining([{ from: 'data:requests', to: 'data:params', label: 'first request' }]));
    expect(result.dataFlow.caption).toContain('not a runtime trace');
  });
  it('keeps repeated interactions in a source-order sequence and excludes trivial security and dependencies', () => {
    const result = visualise(sample);
    expect(result.availableTypes).toContain('sequence');
    expect(result.sequence.sequence?.messages.filter(m => m.label === 'fireEvent.click()')).toHaveLength(2);
    expect(result.sequence.sequence?.participants.map(p => p.label)).toEqual(expect.arrayContaining(['screen', 'fireEvent', 'queryClient']));
    expect(result.sequence.caption).toContain('not an execution trace');
    expect(result.availableTypes).not.toContain('dependencies');
    expect(result.availableTypes).not.toContain('security');
  });
  it('shows asserted counts as expected values and preserves general growth examples', () => {
    const result = visualise(sample);
    expect(result.availableTypes).toEqual(expect.arrayContaining(['cartesian', 'growth']));
    expect(result.cartesian.series?.[0]?.points).toEqual([{ x: 1, y: 3 }, { x: 2, y: 4 }]);
    expect(result.cartesian.caption).toContain('not measured');
    expect(result.growth.caption).toContain('number of recorded requests');
    expect(result.growth.caption).toContain('does not describe the whole test');
    expect(result.growth.series?.[2]?.description).toContain('not shown');
  });
  it('does not invent assertions from a transformation alone', () => {
    const result = visualise({ ...sample, selection: 'const paths = requests.map(url => url.pathname);' });
    expect(result.dataFlow.nodes.some(node => node.label === 'Expected paths')).toBe(false);
  });
  it('only offers security on a specific named guard', () => {
    const result = visualise({ ...sample, selection: 'authService.validateToken(token);' });
    expect(result.availableTypes).toContain('security');
    expect(result.security.caption).toContain('do not prove');
  });
});


describe('JUnit test class overview', () => {
  const names = ['allScope_appliesSearchFilterOrderedByName', 'partnersScope_intersectsFiltersWithScope', 'noneScope_returnsEmpty', 'productsScope_throwsIllegalState', 'blankSearch_isTreatedAsNoFilter', 'statusFilter_matchesSuspendedPartners', 'productFilter_matchesLinkedPartners', 'search_escapesLikeSpecialCharacters', 'emptyPartnersScope_returnsEmpty', 'search_escapesUnderscoresAndBackslashesAndTrimsWhitespace'];
  const source = `class PartnerServiceFilterIntTest {
    // @Test void fake() { assertTrue(false); }
    @BeforeEach void setUp() { repo.clear(); }
    ${names.map(name => `@Test void ${name}() { String literal = "} 😀 @Test fake {"; /* } */ assertThat(result).containsExactly("expected"); }`).join('\n')}
    private Object helper() { return null; }
  }`;
  const ctx = { file: 'PartnerServiceFilterIntTest.java', line: 20, language: 'java', selection: source, surrounding: '' };
  it('includes every declared test and its own assertion without implying coverage or sequential execution', () => {
    const diagrams = visualise(ctx);
    const testNodes = diagrams.testing.nodes.filter(node => node.id.startsWith('junit:test:'));
    const assertNodes = diagrams.testing.nodes.filter(node => node.id.startsWith('junit:assert:'));
    expect(testNodes.map(node => node.label)).toEqual(names.map(name => `@Test ${name}()`));
    expect(assertNodes).toHaveLength(10);
    expect(assertNodes[9]?.label).toContain('containsExactly("expected")');
    for (const test of testNodes) {
      expect(diagrams.testing.edges.filter(edge => edge.from === test.id && edge.label === 'asserts')).toHaveLength(1);
      expect(test.sourceLine).toBeGreaterThanOrEqual(20);
    }
    expect(diagrams.testing.caption).toContain('not evidence of execution or branch coverage');
    expect(diagrams.testing.caption).toContain('Select one test method');
    for (const type of ['dataFlow', 'sequence', 'dependencies', 'circuit', 'wireframe', 'decisions', 'security']) expect(diagrams.availableTypes).not.toContain(type);
    expect(diagrams.availableTypes[0]).toBe('testing');
    expect(diagrams.availableTypes).toContain('growth');
  });
  it('does not combine branches or security calls across different tests', () => {
    const code = 'class T { @Test void first() { if (flag) authService.validateToken(token); } @Test void second() { assertTrue(true); } }';
    const result = visualise({ ...ctx, selection: code });
    expect(result.availableTypes).not.toContain('decisions');
    expect(result.availableTypes).not.toContain('security');
  });
  it('associates setup with tests in the same class, and leaves nested-class setup separate', () => {
    const code = `class Outer { @BeforeEach void outerSetup() {} @Test void outerTest() { assertTrue(true); }
      class Inner { @BeforeEach void innerSetup() {} @Test void innerTest() { assertTrue(true); } } }`;
    const diagram = visualise({ ...ctx, selection: code }).testing;
    const outer = diagram.nodes.find(node => node.label.includes('outerTest'))!;
    const inner = diagram.nodes.find(node => node.label.includes('innerTest'))!;
    const outerSetup = diagram.nodes.find(node => node.label.includes('outerSetup'))!;
    const innerSetup = diagram.nodes.find(node => node.label.includes('innerSetup'))!;
    expect(diagram.edges).toContainEqual({ from: outerSetup.id, to: outer.id, label: 'before each' });
    expect(diagram.edges).toContainEqual({ from: innerSetup.id, to: inner.id, label: 'before each' });
    expect(diagram.edges).not.toContainEqual({ from: innerSetup.id, to: outer.id, label: 'before each' });
  });
  it('caps large overviews and states exactly what was omitted', () => {
    const many = Array.from({ length: 62 }, (_, index) => `@Test void test${index}() { ${'assertTrue(true);'.repeat(8)} }`).join('\n');
    const diagram = visualise({ ...ctx, selection: `class T { ${many} }` }).testing;
    expect(diagram.nodes.filter(node => node.id.startsWith('junit:test:'))).toHaveLength(60);
    expect(diagram.nodes.filter(node => node.id.startsWith('junit:assert:'))).toHaveLength(360);
    expect(diagram.caption).toContain('2 additional tests');
    expect(diagram.caption).toContain('120 additional assertions in shown tests');
    expect(diagram.caption).toContain('inherited setup may also apply');
  });
  it('ignores incomplete methods and never manufactures an assertion', () => {
    const diagram = visualise({ ...ctx, selection: 'class T { @Test void present() {} @Test void cutOff() {' }).testing;
    expect(diagram.nodes.some(node => node.label.includes('cutOff'))).toBe(false);
    expect(diagram.nodes.some(node => node.kind === 'assert')).toBe(false);
  });
});
