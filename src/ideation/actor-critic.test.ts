import { describe, expect, it } from 'vitest';
import { actorCriticTelemetry, ideaDebate } from './actor-critic';
import type { IdeaVerification } from './ideation';

const supported: IdeaVerification = {
  level: 'Context supported',
  evidence: 'x',
  challenge: 'c',
  check: 'k',
  pattern: 'p',
};
const speculation: IdeaVerification = { ...supported, level: 'Speculation' };
const refuted: IdeaVerification = { ...supported, level: 'Refuted' };

describe('actor-critic telemetry', () => {
  it('marks disagreement when the critic does not fully support a proposal', () => {
    expect(ideaDebate(supported).disagrees).toBe(false);
    expect(ideaDebate(speculation).disagrees).toBe(true);
    expect(ideaDebate(refuted).disagrees).toBe(true);
  });

  it('computes disagreement rate and cross-model flag', () => {
    const telemetry = actorCriticTelemetry('qwen2.5-coder:14b', 'deepseek-r1:8b', [supported, speculation, refuted]);
    expect(telemetry.crossModel).toBe(true);
    expect(telemetry.disagreements).toBe(2);
    expect(telemetry.total).toBe(3);
    expect(telemetry.disagreementRate).toBeCloseTo(2 / 3);
    expect(telemetry.disagreementPct).toBe('67%');
  });
});
