import { describe, expect, it } from 'vitest';
import { javaTestingDiagram, junitReadOutline } from './junit-outline';

describe('junitReadOutline', () => {
  const names = ['filtersByName', 'returnsEmptyWhenNone'];
  const source = `class PartnerFilterTest {
    @BeforeEach void reset() { repo.clear(); }
    ${names.map((name) => `@Test void ${name}() { assertThat(service.find()).containsExactly("x"); }`).join('\n')}
  }`;
  const ctx = { file: 'src/PartnerFilterTest.java', line: 10, language: 'java', selection: source, surrounding: '' };

  it('lists tests with line numbers and assertion snippets without a model call', () => {
    const outline = junitReadOutline(ctx);
    expect(outline).toBeTruthy();
    expect(outline!.tests.map((entry) => entry.name)).toEqual(names);
    expect(outline!.setup).toEqual([{ name: 'reset', line: 11 }]);
    expect(outline!.tests[0]!.assertions[0]).toContain('containsExactly');
    expect(outline!.note).toMatch(/Skim this map/i);
  });

  it('returns null when selection is not a multi-test Java class', () => {
    expect(junitReadOutline({ ...ctx, selection: 'class X { void work() {} }' })).toBeNull();
    expect(junitReadOutline({ ...ctx, language: 'typescript', file: 'x.ts', selection: '@Test void x() {}' })).toBeNull();
  });

  it('shares parsing with javaTestingDiagram', () => {
    const diagram = javaTestingDiagram(ctx);
    expect(diagram!.nodes.filter((node) => node.id.startsWith('junit:test:'))).toHaveLength(2);
  });
});
