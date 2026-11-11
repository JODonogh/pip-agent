import { describe, expect, it } from 'vitest';
import { enrichDataFlowForLlm, llmPhysicsDiagram } from './llm-physics';
import { visualise } from './visualise';
import type { CodeContext } from '../shared/types';

const ctx: CodeContext = {
  file: 'sample.ts',
  line: 1,
  language: 'typescript',
  selection: `export function pick(n: number) {
  if (n < 0) { return null; }
  return { value: n };
}`,
  surrounding: '',
};

describe('LLM glass box diagrams', () => {
  it('plots attention O(n²) and KV O(n) on shared token axis', () => {
    const diagram = llmPhysicsDiagram(ctx);
    expect(diagram.series?.map((line) => line.name)).toEqual(
      expect.arrayContaining(['KV cache O(n)', 'Attention O(n²)']),
    );
    const quad = diagram.series?.find((line) => line.name === 'Attention O(n²)');
    const linear = diagram.series?.find((line) => line.name === 'KV cache O(n)');
    expect(quad?.points?.find((point) => point.x === 1000)?.y).toBeGreaterThan(
      linear?.points?.find((point) => point.x === 1000)?.y ?? 0,
    );
  });

  it('overlays measured stats when provided', () => {
    const diagram = llmPhysicsDiagram(ctx, {
      stats: [
        { worker: 'explainer', model: 'qwen', latencyMs: 1200, estTokens: 400, costUsd: 0, fromMock: false, at: 1 },
        { worker: 'probe', model: 'qwen', latencyMs: 2400, estTokens: 1600, costUsd: 0, fromMock: false, at: 2 },
      ],
    });
    expect(diagram.series?.some((line) => line.name === 'Measured round-trip (ms)')).toBe(true);
  });

  it('enriches data flow with token stream and decode branches', () => {
    const base = visualise(ctx, undefined, null);
    const enriched = enrichDataFlowForLlm(ctx, base.dataFlow, { stats: [], temperature: 0.8 });
    expect(enriched.nodes.some((node) => node.id === 'llm:token-stream')).toBe(true);
    expect(enriched.edges.some((edge) => edge.label === 'decode branch')).toBe(true);
    expect(enriched.caption).toContain('Glass box');
  });

  it('exposes llmPhysics in visualise when glass input is present', () => {
    const views = visualise(ctx, undefined, { stats: [] });
    expect(views.availableTypes).toContain('llmPhysics');
    expect(views.dataFlow.caption).toContain('Glass box');
  });
});
