import { describe, expect, it, vi } from 'vitest';
import { evaluateDuck, evaluateExplanation, evaluateQuickFire } from './evaluator';
import { assertLocalhost } from './types';
import { MockProvider, OllamaProvider } from './provider';
import { bestHint, grade, hintScore, sortForReview } from './memory';
import type { Concept } from './types';

describe('localhost enforcement', () => {
  it('accepts localhost and 127.0.0.1', () => {
    expect(assertLocalhost('http://127.0.0.1:11434').hostname).toBe('127.0.0.1');
    expect(assertLocalhost('http://localhost:11434').hostname).toBe('localhost');
  });
  it('rejects any remote model host', () => {
    expect(() => assertLocalhost('https://api.openai.com')).toThrow(/local-only/);
    expect(() => assertLocalhost('http://192.168.1.10:11434')).toThrow(/local-only/);
  });
});

describe('OllamaProvider', () => {
  it('parses a chat response via stubbed fetch (no network)', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: 'BOTTOM_LINE: hi' } }),
    })) as unknown as typeof fetch;
    const provider = new OllamaProvider('http://127.0.0.1:11434', fetchFn);
    const result = await provider.chat([{ role: 'user', content: 'x' }], 'mistral:latest');
    expect(result.text).toBe('BOTTOM_LINE: hi');
    expect(result.fromMock).toBe(false);
  });
  it('throws on a dead server so the orchestrator can fall back', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const provider = new OllamaProvider('http://127.0.0.1:11434', fetchFn);
    await expect(provider.chat([{ role: 'user', content: 'x' }], 'mistral')).rejects.toThrow();
  });
});

describe('evaluator', () => {
  it('keeps bottom line first and caps chunk words', () => {
    const raw = `BOTTOM_LINE: One line. Extra sentence.\n### Big\n${'word '.repeat(80)}`;
    const out = evaluateExplanation(raw);
    expect(out.bottomLine).toBe('One line.');
    expect(out.chunks[0]?.body).toContain('[cut by evaluator]');
    expect(out.repaired).toBe(true);
  });
  it('quick-fire always returns exactly one sentence', () => {
    expect(evaluateQuickFire('First. Second! Third?').text).toBe('First.');
  });
  it('duck ends with exactly one question', () => {
    const out = evaluateDuck('Holds, because of X? Also Y?');
    expect(out.text.endsWith('?')).toBe(true);
    expect((out.text.match(/\?/g) ?? []).length).toBe(1);
  });
  it('mock provider explains deterministically', async () => {
    const mock = new MockProvider();
    const res = await mock.chat(
      [{ role: 'user', content: '[INTENT:explain]\n```ts\nconst x = 1;\n```' }],
      'mock',
    );
    expect(res.fromMock).toBe(true);
    expect(evaluateExplanation(res.text).bottomLine).toContain('const x = 1;');
  });
});

const concept = (over: Partial<Concept>): Concept => ({
  id: '1',
  term: 'closure',
  bottomLine: 'A closure captures variables from its scope',
  file: 'a.ts',
  line: 1,
  createdAt: 0,
  lastSeenAt: 0,
  hits: 0,
  misses: 0,
  mastered: false,
  ...over,
});

describe('memory scoring (simplified conditioning)', () => {
  const now = 1_700_000_000_000;
  it('recent strong cue beats an old one (eligibility trace)', () => {
    const recent = concept({ id: 'r', lastSeenAt: now });
    const old = concept({ id: 'o', lastSeenAt: now - 30 * 86_400_000 });
    expect(hintScore(recent, 'how does a closure capture scope', now)).toBeGreaterThan(
      hintScore(old, 'how does a closure capture scope', now),
    );
  });
  it('mastered concepts are blocked from hinting', () => {
    const mastered = concept({ mastered: true, lastSeenAt: now });
    expect(bestHint([mastered], 'closure capture scope', now)).toBeNull();
  });
  it('overshadowing: only the strongest cue is offered', () => {
    const strong = concept({ id: 's', lastSeenAt: now, misses: 3 });
    const weak = concept({ id: 'w', lastSeenAt: now - 6 * 86_400_000 });
    expect(bestHint([weak, strong], 'closure capture scope variables', now)?.id).toBe('s');
  });
  it('grade: miss makes a weak spot that sorts first; two hits master it', () => {
    const missed = grade(concept({}), false, now);
    expect(sortForReview([concept({ id: 'x' }), missed])[0]?.id).toBe('1');
    const once = grade(concept({}), true, now);
    expect(grade(once, true, now).mastered).toBe(true);
  });
});
