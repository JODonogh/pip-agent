import { describe, expect, it } from 'vitest';
import { buildGlassBoxInspection, ungroundedSpansInExplanation } from './glass-box';
import { explainPrompt } from './prompts';
import type { CodeContext, Explanation, ProviderResult } from '../shared/types';

const ctx: CodeContext = {
  file: 'foo.ts',
  line: 2,
  language: 'typescript',
  selection: 'if (x < 0) return null;\nreturn x * 2;',
  surrounding: '',
};

const result: ProviderResult & { latencyMs: number } = {
  text: 'BOTTOM_LINE: ok\n### Branch\nReturns null for negatives.',
  model: 'qwen2.5-coder:3b',
  fromMock: false,
  latencyMs: 900,
  tokensPerSecond: 24,
  telemetry: {
    totalDurationMs: 900,
    loadDurationMs: 10,
    promptEvalCount: 420,
    promptEvalDurationMs: 200,
    evalCount: 80,
    evalDurationMs: 700,
    tokensPerSecond: 24,
  },
};

describe('glass box inspections', () => {
  it('captures prompt parts, anchors, and telemetry', () => {
    const messages = explainPrompt(ctx);
    const explanation: Explanation = {
      bottomLine: 'Returns null for negatives.',
      chunks: [{ title: 'Branch', body: 'The guard handles negative input.' }],
      repaired: false,
    };
    const box = buildGlassBoxInspection(messages, ctx, explanation, result);
    expect(box.parts).toHaveLength(2);
    expect(box.totalEstTokens).toBeGreaterThan(50);
    expect(box.fewShotAnchors.length).toBeGreaterThan(0);
    expect(box.tokensPerSecond).toBe(24);
    expect(box.telemetry?.promptEvalCount).toBe(420);
  });

  it('flags ungrounded status and exception language', () => {
    const explanation: Explanation = {
      bottomLine: 'This throws a 401 exception for bad callers.',
      chunks: [],
      repaired: false,
    };
    expect(ungroundedSpansInExplanation(ctx, explanation)).toContain('401');
    expect(ungroundedSpansInExplanation(ctx, explanation).join(' ')).toMatch(/exception/i);
  });
});
