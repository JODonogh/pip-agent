import { describe, expect, it } from 'vitest';
import { analyzeCode, analyzeDiagrams } from './diagram';
import type { CodeContext } from '../shared/types';

const context = (selection: string): CodeContext => ({
  file: 'PartnerService.java', line: 40, language: 'java', selection, surrounding: '',
});
const utility = context(`private String normalizeSearch(String search) {
  if (search == null || search.isBlank()) { return null; }
  return search.trim();
}`);

describe('useful diagram views', () => {
  it('excludes a singleton architecture while offering source order and dependencies for a utility', () => {
    const diagrams = analyzeDiagrams(utility);
    expect(diagrams.availableTypes).not.toContain('architecture');
    expect(diagrams.availableTypes).toContain('sequence');
    expect(diagrams.availableTypes).toContain('dependencies');
    expect(diagrams.dependencies.nodes.map((node) => node.label)).toEqual(['normalizeSearch()', 'search']);
    expect(diagrams.sequence.caption).toContain('not an execution trace');
  });

  it('preserves a complete nested condition and every return site instead of implying one exit', () => {
    const diagram = analyzeCode(utility);
    expect(diagram.nodes.find((node) => node.kind === 'branch')?.label).toBe('if (search == null || search.isBlank())');
    expect(diagram.nodes.filter((node) => node.kind === 'return').map((node) => node.label)).toEqual(['return null', 'return search.trim()']);
  });

  it('keeps repeated call sites and source positions in sequence order', () => {
    const diagrams = analyzeDiagrams(context(`public void work() {
  first.run();
  if (ready.check()) { second.run(); }
  first.run();
}`));
    const calls = diagrams.sequence.nodes.filter((node) => node.kind === 'call');
    expect(calls.map((node) => node.label)).toEqual(['first.run()', 'ready.check()', 'second.run()', 'first.run()']);
    expect(calls.map((node) => node.sourceLine)).toEqual([41, 42, 42, 43]);
    expect(diagrams.sequence.nodes.map((node) => node.order)).toEqual(diagrams.sequence.nodes.map((node) => node.order).sort((a, b) => (a ?? 0) - (b ?? 0)));
  });

  it('offers architecture for a real endpoint relationship and rooted dependency links', () => {
    const diagrams = analyzeDiagrams(context('@GetMapping("/partners")\npublic List<Partner> find() { return partnerService.findAll(); }'));
    expect(diagrams.availableTypes).toContain('architecture');
    expect(diagrams.architecture.nodes.some((node) => node.kind === 'endpoint')).toBe(true);
    expect(diagrams.dependencies.nodes.some((node) => node.label === 'partnerService')).toBe(true);
    expect(diagrams.dependencies.edges.every((edge) => edge.from === 'method:find')).toBe(true);
  });

  it('does not invent architecture, a testing plan, or a sequence from imports alone', () => {
    const diagrams = analyzeDiagrams(context('import java.util.List;\nimport java.util.Set;'));
    expect(diagrams.availableTypes).not.toContain('architecture');
    expect(diagrams.availableTypes).not.toContain('testing');
    expect(diagrams.availableTypes).not.toContain('sequence');
    expect(diagrams.availableTypes).toContain('dependencies');
  });

  it('does not treat a parameter by itself as a project architecture', () => {
    const diagrams = analyzeDiagrams(context('public String identity(String value) { return value; }'));
    expect(diagrams.availableTypes).not.toContain('architecture');
    expect(diagrams.availableTypes).not.toContain('dependencies');
  });
});
